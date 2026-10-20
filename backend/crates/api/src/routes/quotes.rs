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

pub fn routes() -> Router<AppState> {
    Router::new().route("/quotes", post(create_quote))
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

    let fee_minor = i64::try_from(fee_result.fee_minor).map_err(|_| {
        ApiError::BadRequest("fee amount overflows i64".to_owned())
    })?;

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
        fixed_minor: parse_minor(&row.fixed_minor)
            .map_err(ApiError::Internal)?,
        bps: u32::try_from(row.bps)
            .map_err(|_| ApiError::Internal(anyhow::anyhow!("bps overflows u32")))?,
        min_fee_minor: parse_minor(&row.min_fee_minor)
            .map_err(ApiError::Internal)?,
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


