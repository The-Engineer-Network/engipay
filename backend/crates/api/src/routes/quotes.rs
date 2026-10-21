//! POST /v1/quotes — compute and persist a fee quote.
//!
//! A quote locks in the fee for a given (product, asset, gross amount) triple.
//! It stores:
//!   * `fee_minor`        – the fee computed at quote time
//!   * `schedule_version` – the UUID of the `fee_schedules` row used
//!   * `expires_at`       – the quote is only valid for `QUOTE_TTL_SECS`
//!
//! Settlement must pass the `quote_id` back; the ledger verifies that the
//! `schedule_version` it reads from `quotes` matches the one it was given,
//! so a fee-schedule change between quoting and settling cannot silently
//! alter the fee.
//!
//! Without a database the endpoint returns the computed fee directly but does
//! not persist it, which is useful in local development and in unit tests.

use axum::extract::State;
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use engipay_core::{Asset, FeeSchedule, Product};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;

/// How long a quote is valid for.
const QUOTE_TTL_SECS: i64 = 300; // 5 minutes

/// How long a Stellar path quote is valid for.  Paths move quickly, so this is
/// deliberately shorter than the fee-quote TTL.
const STELLAR_PATH_QUOTE_TTL_SECS: i64 = 60; // 1 minute

/// Upper bound on the slippage a client may ask for, in basis points (5%).
const MAX_SLIPPAGE_BPS: u32 = 500;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/quotes", post(create_quote))
        .route("/quotes/stellar-path", post(create_stellar_path_quote))
}

#[derive(Debug, Deserialize)]
pub struct QuoteRequest {
    pub product: Product,
    pub asset: Asset,
    /// Gross amount the user wants to send/convert/withdraw, in the asset's
    /// smallest units (same convention as the ledger).
    pub gross_minor: i64,
}

#[derive(Debug, Serialize)]
pub struct QuoteResponse {
    /// Stable id for this quote. Pass it to the settle endpoint.
    pub quote_id: Uuid,
    pub product: Product,
    pub asset: Asset,
    pub gross_minor: i64,
    /// Fee in the asset's smallest units.
    pub fee_minor: i64,
    /// The `fee_schedules.id` that produced this fee.  Settlement rejects any
    /// quote whose stored version doesn't match what it recorded.
    pub schedule_version: Uuid,
    /// ISO-8601 expiry time. The client must re-quote after this.
    pub expires_at: String,
}

async fn create_quote(
    State(state): State<AppState>,
    Json(req): Json<QuoteRequest>,
) -> Result<Json<QuoteResponse>, ApiError> {
    if req.gross_minor <= 0 {
        return Err(ApiError::BadRequest(
            "gross_minor must be greater than zero".to_owned(),
        ));
    }

    // Fetch the active schedule.  With a database we query Postgres; without
    // one we fall back to the built-in seed schedules.
    let schedule = match &state.database {
        Some(pool) => fetch_active_schedule(pool, req.product, req.asset).await?,
        None => fallback_schedule(req.product, req.asset).ok_or(ApiError::NotFound)?,
    };

    let fee_result = schedule
        .compute_fee(i128::from(req.gross_minor))
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let fee_minor = i64::try_from(fee_result.fee_minor)
        .map_err(|_| ApiError::BadRequest("fee amount overflows i64".to_owned()))?;

    let now = Utc::now();
    let expires_at = now
        + chrono::Duration::try_seconds(QUOTE_TTL_SECS)
            .expect("constant QUOTE_TTL_SECS is always valid");

    let quote_id = Uuid::new_v4();

    // Persist when a database is available.
    if let Some(pool) = &state.database {
        sqlx::query(
            "INSERT INTO quotes (id, product, asset, gross_minor, fee_minor, schedule_version, expires_at)
             VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6, $7)",
        )
        .bind(quote_id)
        .bind(req.product.as_str())
        .bind(req.asset.symbol())
        .bind(req.gross_minor)
        .bind(fee_minor)
        .bind(fee_result.schedule_version)
        .bind(expires_at)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    }

    Ok(Json(QuoteResponse {
        quote_id,
        product: req.product,
        asset: req.asset,
        gross_minor: req.gross_minor,
        fee_minor,
        schedule_version: fee_result.schedule_version,
        expires_at: expires_at.to_rfc3339(),
    }))
}

/// Which side of a Stellar path payment the caller is fixing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StellarPathMode {
    /// The source amount is fixed; the destination amount may vary within the
    /// slippage bound.
    StrictSend,
    /// The destination amount is fixed; the source amount may vary within the
    /// slippage bound.
    StrictReceive,
}

impl StellarPathMode {
    pub fn as_str(self) -> &'static str {
        match self {
            StellarPathMode::StrictSend => "strict_send",
            StellarPathMode::StrictReceive => "strict_receive",
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct StellarPathQuoteRequest {
    /// Asset the sender holds and will spend (e.g. `XLM`).
    pub source_asset: Asset,
    /// Asset the recipient wants to receive (e.g. `USDC`).
    pub destination_asset: Asset,
    /// Whether `amount_minor` fixes the source or the destination side.
    pub mode: StellarPathMode,
    /// Amount in the fixed side's smallest units.
    pub amount_minor: i64,
    /// Slippage the user agreed to, in basis points (e.g. `50` = 0.5%).
    pub slippage_bps: u32,
}

#[derive(Debug, Serialize)]
pub struct StellarPathQuoteResponse {
    /// Stable id for this quote. Pass it to the send endpoint.
    pub quote_id: Uuid,
    pub mode: StellarPathMode,
    pub source_asset: Asset,
    pub destination_asset: Asset,
    /// Amount the sender will spend, in the source asset's smallest units.
    pub source_amount_minor: i64,
    /// Amount the recipient will receive, in the destination asset's smallest
    /// units.
    pub destination_amount_minor: i64,
    /// Intermediate assets in the path (empty for a direct path).
    pub path: Vec<Asset>,
    /// Slippage the user agreed to, in basis points.
    pub slippage_bps: u32,
    /// Worst-case amount on the variable side, derived from `slippage_bps`.
    /// For strict-send this is the minimum destination amount; for
    /// strict-receive it is the maximum source amount.
    pub slippage_bound_minor: i64,
    /// ISO-8601 expiry time. The client must re-quote after this.
    pub expires_at: String,
}

/// Quote returned by the chain service's path-quote endpoint.
#[derive(Debug, Clone, Deserialize)]
pub struct ChainPathQuote {
    pub source_amount_minor: i64,
    pub destination_amount_minor: i64,
    #[serde(default)]
    pub path: Vec<Asset>,
}

/// Compute the worst-case amount on the variable side of a path payment.
///
/// For strict-send the destination amount may fall by `slippage_bps`; for
/// strict-receive the source amount may rise by `slippage_bps`.  Rounding is
/// always in the user's disfavour so the bound is never looser than requested.
fn slippage_bound(mode: StellarPathMode, amount_minor: i64, slippage_bps: u32) -> i64 {
    let bps = i128::from(slippage_bps);
    let amount = i128::from(amount_minor);
    let delta = amount * bps / 10_000;
    let bound = match mode {
        // Minimum destination: round the reduction up.
        StellarPathMode::StrictSend => amount - (amount * bps).div_ceil(10_000),
        // Maximum source: round the increase up.
        StellarPathMode::StrictReceive => amount + delta.max(0),
    };
    i64::try_from(bound).unwrap_or(i64::MAX)
}

async fn create_stellar_path_quote(
    State(state): State<AppState>,
    Json(req): Json<StellarPathQuoteRequest>,
) -> Result<Json<StellarPathQuoteResponse>, ApiError> {
    if req.amount_minor <= 0 {
        return Err(ApiError::BadRequest(
            "amount_minor must be greater than zero".to_owned(),
        ));
    }
    if req.source_asset == req.destination_asset {
        return Err(ApiError::BadRequest(
            "source_asset and destination_asset must differ".to_owned(),
        ));
    }
    if req.slippage_bps > MAX_SLIPPAGE_BPS {
        return Err(ApiError::BadRequest(format!(
            "slippage_bps must not exceed {MAX_SLIPPAGE_BPS}"
        )));
    }

    let chain = state.chain.as_ref().ok_or_else(|| {
        ApiError::Internal(anyhow::anyhow!("chain service is not configured"))
    })?;

    let quote = chain
        .quote_path(
            req.source_asset,
            req.destination_asset,
            req.mode,
            req.amount_minor,
        )
        .await
        .map_err(|e| ApiError::BadRequest(format!("could not find a path: {e}")))?;

    // Sanity-check the chain service's answer against the fixed side.
    let (source_amount_minor, destination_amount_minor) = match req.mode {
        StellarPathMode::StrictSend => {
            if quote.source_amount_minor != req.amount_minor {
                return Err(ApiError::Internal(anyhow::anyhow!(
                    "chain service returned source amount {} for strict-send of {}",
                    quote.source_amount_minor,
                    req.amount_minor
                )));
            }
            (quote.source_amount_minor, quote.destination_amount_minor)
        }
        StellarPathMode::StrictReceive => {
            if quote.destination_amount_minor != req.amount_minor {
                return Err(ApiError::Internal(anyhow::anyhow!(
                    "chain service returned destination amount {} for strict-receive of {}",
                    quote.destination_amount_minor,
                    req.amount_minor
                )));
            }
            (quote.source_amount_minor, quote.destination_amount_minor)
        }
    };

    if source_amount_minor <= 0 || destination_amount_minor <= 0 {
        return Err(ApiError::BadRequest(
            "path quote produced a non-positive amount".to_owned(),
        ));
    }

    let variable_amount = match req.mode {
        StellarPathMode::StrictSend => destination_amount_minor,
        StellarPathMode::StrictReceive => source_amount_minor,
    };
    let slippage_bound_minor = slippage_bound(req.mode, variable_amount, req.slippage_bps);

    let now = Utc::now();
    let expires_at = now
        + chrono::Duration::try_seconds(STELLAR_PATH_QUOTE_TTL_SECS)
            .expect("constant STELLAR_PATH_QUOTE_TTL_SECS is always valid");

    let quote_id = Uuid::new_v4();

    // Persist when a database is available so the send can reference it.
    if let Some(pool) = &state.database {
        let path_symbols: Vec<String> = quote.path.iter().map(|a| a.symbol().to_owned()).collect();
        sqlx::query(
            "INSERT INTO stellar_path_quotes
                 (id, mode, source_asset, destination_asset, source_amount_minor,
                  destination_amount_minor, path, slippage_bps, slippage_bound_minor, expires_at)
             VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9::numeric, $10)",
        )
        .bind(quote_id)
        .bind(req.mode.as_str())
        .bind(req.source_asset.symbol())
        .bind(req.destination_asset.symbol())
        .bind(source_amount_minor)
        .bind(destination_amount_minor)
        .bind(&path_symbols)
        .bind(i32::try_from(req.slippage_bps).unwrap_or(i32::MAX))
        .bind(slippage_bound_minor)
        .bind(expires_at)
        .execute(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    }

    Ok(Json(StellarPathQuoteResponse {
        quote_id,
        mode: req.mode,
        source_asset: req.source_asset,
        destination_asset: req.destination_asset,
        source_amount_minor,
        destination_amount_minor,
        path: quote.path,
        slippage_bps: req.slippage_bps,
        slippage_bound_minor,
        expires_at: expires_at.to_rfc3339(),
    }))
}

/// Row returned by the schedule lookup query.
#[derive(sqlx::FromRow)]
struct ScheduleRow {
    id: Uuid,
    /// NUMERIC cast to TEXT (no bigdecimal feature in workspace).
    fixed_minor: String,
    bps: i32,
    min_fee_minor: String,
    max_fee_minor: Option<String>,
}

/// Query the most-recently-effective schedule for (product, asset) that became
/// effective at or before now.
///
/// NUMERIC(78,0) columns are cast to TEXT in the query and then parsed, because
/// the `sqlx` workspace config does not pull in the `bigdecimal` feature.  Fee
/// amounts fit comfortably in i64; the cast will fail at runtime if one does not.
async fn fetch_active_schedule(
    pool: &sqlx::PgPool,
    product: Product,
    asset: Asset,
) -> Result<FeeSchedule, ApiError> {
    let row: ScheduleRow = sqlx::query_as(
        "SELECT id,
                fixed_minor::TEXT   AS fixed_minor,
                bps,
                min_fee_minor::TEXT AS min_fee_minor,
                max_fee_minor::TEXT AS max_fee_minor
         FROM   fee_schedules
         WHERE  product        = $1
           AND  asset          = $2
           AND  effective_from <= now()
         ORDER  BY effective_from DESC
         LIMIT  1",
    )
    .bind(product.as_str())
    .bind(asset.symbol())
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
    .ok_or(ApiError::NotFound)?;

    fn parse_minor(s: &str) -> anyhow::Result<i128> {
        s.parse::<i128>().map_err(|e| {
            anyhow::anyhow!("could not parse NUMERIC column as i128: {e} (value: {s:?})")
        })
    }

    Ok(FeeSchedule {
        id: row.id,
        product,
        asset,
        fixed_minor: parse_minor(&row.fixed_minor).map_err(ApiError::Internal)?,
        bps: u32::try_from(row.bps)
            .map_err(|_| ApiError::Internal(anyhow::anyhow!("bps overflows u32")))?,
        min_fee_minor: parse_minor(&row.min_fee_minor).map_err(ApiError::Internal)?,
        max_fee_minor: row
            .max_fee_minor
            .as_deref()
            .map(parse_minor)
            .transpose()
            .map_err(ApiError::Internal)?,
    })
}

/// Hard-coded schedules that mirror the seed data in `0002_fee_schedules.sql`.
/// Used only when there is no database (local dev / unit tests).
pub fn fallback_schedule(product: Product, asset: Asset) -> Option<FeeSchedule> {
    // All amounts in 7-decimal USDC smallest units.
    const USDC: i128 = 10_000_000;
    if asset != Asset::Usdc {
        return None;
    }
    let (id_suffix, fixed, bps, min, max): (u128, i128, u32, i128, Option<i128>) = match product {
        Product::Transfer => (1, USDC / 10, 0, 0, None),
        Product::Withdrawal => (2, USDC / 2, 30, USDC / 2, Some(10 * USDC)),
        Product::Conversion => (3, 0, 30, USDC / 10, Some(5 * USDC)),
        Product::Buy => (4, 0, 100, USDC / 2, None),
        Product::Sell => (5, 0, 100, USDC / 2, None),
    };
    Some(FeeSchedule {
        id: Uuid::from_u128(id_suffix),
        product,
        asset,
        fixed_minor: fixed,
        bps,
        min_fee_minor: min,
        max_fee_minor: max,
    })
}
