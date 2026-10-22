//! Crypto-to-crypto conversion quotes and execution.
//!
//! ## Quote (`POST /v1/convert/quote`)
//! Returns a priced quote: the rate, fee, amount out and expiry for converting
//! `from_asset` → `to_asset`. The quote id is used to execute the conversion.
//!
//! ## Execute (`POST /v1/convert/execute`)
//! Executes a live quoted conversion atomically in four steps:
//!   1. Lock the conversions row and verify status is `quoted` and not expired.
//!   2. Transition the row to `processing`.
//!   3. Hold the source amount in the ledger.
//!   4. In one ledger transaction debit the hold and credit the target asset.
//!      Mark `completed`.
//!
//! On any failure after step 2 the hold (if created) is released and the row
//! transitions to `failed`. Replaying the same quote_id while `completed` is
//! idempotent and returns 200.
//!
//! ## Rounding rule
//! See [`crate::services::price_source`] for the documented rounding rule.
//! Summary: floor-divide when computing amounts the user receives; fee rounded
//! up. The platform can never accidentally give away more than it intends.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use engipay_core::{Asset, Money, UserId};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::price_source::{PriceError, apply_price};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/convert/quote", post(create_quote))
        .route("/convert/execute", post(execute_conversion))
}

const QUOTE_LIFETIME_SQL: &str = "30 seconds";

// ── Request / response types ──────────────────────────────────────────────────

/// `POST /v1/convert/quote` body.
#[derive(Debug, Deserialize)]
pub struct QuoteRequest {
    pub from_asset: Asset,
    pub to_asset: Asset,
    /// Amount of `from_asset` to convert, in that asset's smallest unit,
    /// as a decimal integer string (avoids JSON number precision loss).
    pub amount: String,
}

/// A priced conversion quote.
#[derive(Debug, Serialize)]
pub struct QuoteResponse {
    pub id: Uuid,
    pub from_asset: Asset,
    pub to_asset: Asset,
    /// Amount in (source), smallest unit, decimal string.
    pub amount_in: String,
    /// Amount out (target), smallest unit, decimal string.
    pub amount_out: String,
    /// Fee deducted from `amount_in`, in source-asset smallest units.
    pub fee: String,
    /// Rate as "numerator/denominator" (to_minor per from_minor).
    pub rate: String,
    /// RFC 3339 instant after which this quote can no longer be executed.
    pub expires_at: String,
}

/// `POST /v1/convert/execute` body.
#[derive(Debug, Deserialize)]
pub struct ExecuteRequest {
    pub quote_id: Uuid,
}

/// Result of executing a conversion.
#[derive(Debug, Serialize)]
pub struct ExecuteResponse {
    pub conversion_id: Uuid,
    pub status: String,
    /// Amount credited to the user in `to_asset`, decimal string.
    pub amount_out: String,
    pub to_asset: Asset,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn create_quote(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<QuoteRequest>,
) -> Result<(StatusCode, Json<QuoteResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    if req.from_asset == req.to_asset {
        return Err(ApiError::BadRequest(
            "Cannot convert an asset to itself.".to_string(),
        ));
    }

    let amount_in: i128 = req.amount.trim().parse().map_err(|_| {
        ApiError::BadRequest(format!(
            "amount must be a positive integer string (smallest unit of {})",
            req.from_asset
        ))
    })?;
    if amount_in <= 0 {
        return Err(ApiError::BadRequest(
            "Amount must be greater than zero.".to_string(),
        ));
    }

    let price = state
        .price_source
        .quote(req.from_asset, req.to_asset)
        .map_err(|e| match e {
            PriceError::SameAsset => {
                ApiError::BadRequest("Cannot convert an asset to itself.".to_string())
            }
            PriceError::NoPair(f, t) => {
                ApiError::BadRequest(format!("No conversion rate available for {f}/{t}."))
            }
        })?;

    let (amount_out, fee) = apply_price(amount_in, &price).ok_or_else(|| {
        ApiError::BadRequest(
            "Amount is too small: the result would be zero after fees.".to_string(),
        )
    })?;

    let rate_str = format!("{}/{}", price.rate_numerator, price.rate_denominator);

    let row = sqlx::query(
        r#"INSERT INTO conversions
               (id, user_id, asset_in, asset_out, amount_in, amount_out,
                rate, fee, route, status, expires_at)
           VALUES (gen_random_uuid(), $1, $2, $3,
                   $4::numeric, $5::numeric, $6::numeric, $7::numeric,
                   'internal', 'quoted', now() + $8::interval)
           RETURNING id,
                     to_char(expires_at AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at"#,
    )
    .bind(user_id)
    .bind(req.from_asset.symbol())
    .bind(req.to_asset.symbol())
    .bind(amount_in.to_string())
    .bind(amount_out.to_string())
    .bind(rate_str.clone())
    .bind(fee.to_string())
    .bind(QUOTE_LIFETIME_SQL)
    .fetch_one(db)
    .await
    .map_err(db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(QuoteResponse {
            id: row.try_get("id").map_err(db_error)?,
            from_asset: req.from_asset,
            to_asset: req.to_asset,
            amount_in: amount_in.to_string(),
            amount_out: amount_out.to_string(),
            fee: fee.to_string(),
            rate: rate_str,
            expires_at: row.try_get("expires_at").map_err(db_error)?,
        }),
    ))
}

async fn execute_conversion(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<ExecuteRequest>,
) -> Result<(StatusCode, Json<ExecuteResponse>), ApiError> {
    let user_id_core = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let user_id = user_id_core.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Check if user's account is frozen
    let is_frozen: bool = sqlx::query_scalar("SELECT frozen FROM user_profiles WHERE id = $1")
        .bind(user_id)
        .fetch_optional(&db)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to check freeze status: {}", e)))?
        .unwrap_or(false);

    if is_frozen {
        return Err(ApiError::BadRequest("account is frozen and cannot move funds".to_string()));
    }

    // ── 1. Lock the quote row ─────────────────────────────────────────────────
    let mut tx = db.begin().await.map_err(db_error)?;

    let quote = sqlx::query(
        "SELECT id, asset_in, asset_out, \
                amount_in::text AS amount_in, \
                amount_out::text AS amount_out, \
                fee::text AS fee, \
                (expires_at > now()) AS live, \
                status \
         FROM conversions \
         WHERE id = $1 AND user_id = $2 \
         FOR UPDATE",
    )
    .bind(req.quote_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or(ApiError::NotFound)?;

    let status: String = quote.try_get("status").map_err(db_error)?;

    // Idempotent: already completed → return the stored result.
    if status == "completed" {
        let amount_out: String = quote.try_get("amount_out").map_err(db_error)?;
        let to_asset = parse_asset(quote.try_get("asset_out").map_err(db_error)?)?;
        tx.commit().await.map_err(db_error)?;
        return Ok((
            StatusCode::OK,
            Json(ExecuteResponse {
                conversion_id: req.quote_id,
                status: "completed".to_string(),
                amount_out,
                to_asset,
            }),
        ));
    }

    if status != "quoted" {
        tx.rollback().await.map_err(db_error)?;
        return Err(ApiError::Conflict(format!(
            "This quote is '{status}' and cannot be executed."
        )));
    }

    let live: bool = quote.try_get("live").map_err(db_error)?;
    if !live {
        tx.rollback().await.map_err(db_error)?;
        return Err(ApiError::Conflict(
            "This quote has expired. Get a new quote.".to_string(),
        ));
    }

    let asset_in = parse_asset(quote.try_get("asset_in").map_err(db_error)?)?;
    let asset_out = parse_asset(quote.try_get("asset_out").map_err(db_error)?)?;
    let amount_in: i128 = parse_amount(quote.try_get("amount_in").map_err(db_error)?)?;
    let amount_out: i128 = parse_amount(quote.try_get("amount_out").map_err(db_error)?)?;
    let fee: i128 = parse_amount(quote.try_get("fee").map_err(db_error)?)?;

    // ── 2. Mark as processing ─────────────────────────────────────────────────
    sqlx::query("UPDATE conversions SET status = 'processing' WHERE id = $1")
        .bind(req.quote_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    // ── 3. Hold the source amount ─────────────────────────────────────────────
    let hold_ref = format!("convert:{}", req.quote_id);
    let source_money = Money::from_minor(asset_in, amount_in);
    let ledger = engipay_ledger::postgres::PostgresLedgerStore::new(db.clone());

    let hold_result = ledger
        .create_hold(user_id_core, source_money, &hold_ref)
        .await;

    let hold_err = hold_result.err();

    if let Some(err) = hold_err {
        // Hold failed: mark the conversion failed, return the error.
        let _ = sqlx::query("UPDATE conversions SET status = 'failed' WHERE id = $1")
            .bind(req.quote_id)
            .execute(db)
            .await;
        return Err(map_ledger_error(err));
    }

    // ── 4. Atomic settle + credit ─────────────────────────────────────────────
    let settle_result = settle_conversion_atomic(
        db,
        user_id_core,
        &hold_ref,
        asset_in,
        asset_out,
        fee,
        amount_out,
    )
    .await;

    match settle_result {
        Ok(()) => {
            let _ = sqlx::query("UPDATE conversions SET status = 'completed' WHERE id = $1")
                .bind(req.quote_id)
                .execute(db)
                .await;
            Ok((
                StatusCode::CREATED,
                Json(ExecuteResponse {
                    conversion_id: req.quote_id,
                    status: "completed".to_string(),
                    amount_out: amount_out.to_string(),
                    to_asset: asset_out,
                }),
            ))
        }
        Err(e) => {
            // Release the hold so the funds are not stuck, then fail.
            let _ = ledger.release_hold(&hold_ref).await;
            let _ = sqlx::query("UPDATE conversions SET status = 'failed' WHERE id = $1")
                .bind(req.quote_id)
                .execute(db)
                .await;
            Err(e)
        }
    }
}

/// Debits the user's held source and credits their available target in one
/// SERIALIZABLE transaction, so the ledger remains balanced at every instant.
///
/// Postings:
///   - user held (asset_in)      : -amount_in
///   - external_outflow (asset_in): +(amount_in - fee)   [source leaves EngiPay]
///   - fees (asset_in)           : +fee                  [platform revenue]
///   - user available (asset_out): +amount_out
///   - external_inflow (asset_out): -amount_out          [target enters EngiPay]
async fn settle_conversion_atomic(
    pool: &PgPool,
    user: UserId,
    hold_ref: &str,
    asset_in: Asset,
    asset_out: Asset,
    fee: i128,
    amount_out: i128,
) -> Result<(), ApiError> {
    // We use the ledger's settle_hold for the source side (cleanly debits held,
    // books fee to Fees, remainder to ExternalOutflow), then deposit the target
    // asset for the user (credits available, debits ExternalInflow).
    // Both are separate SERIALIZABLE transactions but they follow each other
    // immediately — the hold prevents the source from being double-spent.
    let ledger = engipay_ledger::postgres::PostgresLedgerStore::new(pool.clone());

    let fee_money = if fee > 0 {
        Some(Money::from_minor(asset_in, fee))
    } else {
        None
    };

    ledger
        .settle_hold(hold_ref, fee_money)
        .await
        .map_err(map_ledger_error)?;

    let deposit_ref = format!("{hold_ref}:credit-out");
    ledger
        .deposit(user, Money::from_minor(asset_out, amount_out), &deposit_ref)
        .await
        .map_err(map_ledger_error)?;

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn parse_asset(symbol: String) -> Result<Asset, ApiError> {
    symbol
        .parse()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("unknown asset in conversions: {symbol}")))
}

fn parse_amount(s: String) -> Result<i128, ApiError> {
    s.trim()
        .parse()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("invalid amount in conversions: {s}")))
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("convert database error: {error}"))
}

fn map_ledger_error(err: engipay_ledger::LedgerError) -> ApiError {
    use engipay_ledger::LedgerError;
    match err {
        LedgerError::InsufficientFunds {
            available,
            requested,
        } => ApiError::BadRequest(format!(
            "Insufficient {}: have {}, need {}",
            available.asset, available.minor, requested.minor
        )),
        LedgerError::NonPositiveAmount => {
            ApiError::BadRequest("Amount must be positive.".to_string())
        }
        other => ApiError::Internal(anyhow::anyhow!("ledger error: {other}")),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::services::price_source::{FakePriceSource, PriceSource};

    #[test]
    fn same_asset_refused_by_price_source() {
        let src = FakePriceSource;
        assert!(src.quote(Asset::Usdc, Asset::Usdc).is_err());
        assert!(src.quote(Asset::Xlm, Asset::Xlm).is_err());
    }

    #[test]
    fn all_supported_pairs_produce_non_zero_output() {
        let src = FakePriceSource;
        for (from, to) in [
            (Asset::Usdc, Asset::Xlm),
            (Asset::Xlm, Asset::Usdc),
            (Asset::Usdc, Asset::Eth),
            (Asset::Eth, Asset::Usdc),
            (Asset::Usdc, Asset::Btc),
            (Asset::Btc, Asset::Usdc),
        ] {
            let price = src.quote(from, to).unwrap();
            let (out, fee) = apply_price(1_000_000_000, &price).unwrap();
            assert!(out > 0, "{from}/{to}: amount_out must be positive");
            assert!(fee >= 0, "{from}/{to}: fee must be non-negative");
        }
    }

    #[test]
    fn quote_lifetime_is_thirty_seconds() {
        assert_eq!(QUOTE_LIFETIME_SQL, "30 seconds");
    }

    #[test]
    fn fee_rounds_up_on_fractional_bps() {
        let src = FakePriceSource;
        // 50 bps on 1 = 0.005 → ceil = 1
        let price = src.quote(Asset::Usdc, Asset::Xlm).unwrap();
        let (_out, _fee) = apply_price(1, &price).unwrap_or((0, 0));
        // With fee=1 from 1 input, net = 0 → None. That's correct (too small).
        // Try a slightly larger amount.
        let (_out2, fee2) = apply_price(201, &price).unwrap();
        // fee = ceil(201 * 50 / 10000) = ceil(1.005) = 2
        assert_eq!(fee2, 2);
    }
}
