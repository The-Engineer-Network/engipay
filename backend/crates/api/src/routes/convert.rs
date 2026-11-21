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
//! ## Get (`GET /v1/convert/orders/{id}`)
//! Returns the caller's conversion (assets, amounts, rate, fee, status).
//! Conversions owned by another user (or nonexistent) return 404.
//!
//! ## Rounding rule
//! See [`crate::services::price_source`] for the documented rounding rule.
//! Summary: floor-divide when computing amounts the user receives; fee rounded
//! up. The platform can never accidentally give away more than it intends.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
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
        .route("/convert/orders/{id}", get(get_conversion))
}

const QUOTE_LIFETIME_SQL: &str = "30 seconds";

// ── Request / response types ──────────────────────────────────────────────────

/// `POST /v1/convert/quote` body.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
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
    /// Price source identifiers used to calculate this quote.
    pub price_sources: Vec<String>,
    /// RFC 3339 instant after which this quote can no longer be executed.
    pub expires_at: String,
}

/// `POST /v1/convert/execute` body.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
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

/// `GET /v1/convert/orders/{id}` response.
#[derive(Debug, Serialize)]
pub struct ConversionResponse {
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
    pub status: String,
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
            _ => ApiError::Unavailable("A reliable conversion price is not available.".to_string()),
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
                rate, fee, route, status, expires_at, price_sources)
           VALUES (gen_random_uuid(), $1, $2, $3,
                   $4::numeric, $5::numeric, $6::numeric, $7::numeric,
                   'internal', 'quoted', now() + $8::interval, $9::text[])
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
    .bind(&price.source_ids)
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
            price_sources: price.source_ids,
            expires_at: row.try_get("expires_at").map_err(db_error)?,
        }),
    ))
}

async fn get_conversion(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<ConversionResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let row = sqlx::query(
        "SELECT id, asset_in, asset_out, \
                amount_in::text AS amount_in, \
                amount_out::text AS amount_out, \
                fee::text AS fee, \
                rate::text AS rate, \
                status \
         FROM conversions \
         WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(db)
    .await
    .map_err(db_error)?
    .ok_or(ApiError::NotFound)?;

    let asset_in: String = row.try_get("asset_in").map_err(db_error)?;
    let asset_out: String = row.try_get("asset_out").map_err(db_error)?;

    Ok(Json(ConversionResponse {
        id: row.try_get("id").map_err(db_error)?,
        from_asset: parse_asset(&asset_in)?,
        to_asset: parse_asset(&asset_out)?,
        amount_in: row.try_get("amount_in").map_err(db_error)?,
        amount_out: row.try_get("amount_out").map_err(db_error)?,
        fee: row.try_get("fee").map_err(db_error)?,
        rate: row.try_get("rate").map_err(db_error)?,
        status: row.try_get("status").map_err(db_error)?,
    }))
}

fn parse_asset(symbol: &str) -> Result<Asset, ApiError> {
    symbol
        .parse::<Asset>()
        .map_err(|_| ApiError::Internal(anyhow::anyhow!("unknown asset symbol: {}", symbol)))
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
    if status == "completed" {
        // Idempotent replay: return the already-credited amount.
        let amount_out: String = quote.try_get("amount_out").map_err(db_error)?;
        let asset_out: String = quote.try_get("asset_out").map_err(db_error)?;
        tx.commit().await.map_err(db_error)?;
        return Ok((
            StatusCode::OK,
            Json(ExecuteResponse {
                conversion_id: req.quote_id,
                status,
                amount_out,
                to_asset: parse_asset(&asset_out)?,
            }),
        ));
    }

    if status != "quoted" {
        return Err(ApiError::BadRequest(format!(
            "conversion is not executable (status: {status})"
        )));
    }

    let live: bool = quote.try_get("live").map_err(db_error)?;
    if !live {
        return Err(ApiError::BadRequest("quote has expired".to_string()));
    }

    // ── 2. Transition to processing ───────────────────────────────────────────
    sqlx::query("UPDATE conversions SET status = 'processing' WHERE id = $1")
        .bind(req.quote_id)
        .execute(&mut *tx)
        .await
        .map_err(db_error)?;

    let asset_in: String = quote.try_get("asset_in").map_err(db_error)?;
    let asset_out: String = quote.try_get("asset_out").map_err(db_error)?;
    let amount_in: String = quote.try_get("amount_in").map_err(db_error)?;
    let amount_out: String = quote.try_get("amount_out").map_err(db_error)?;

    let from_asset = parse_asset(&asset_in)?;
    let to_asset = parse_asset(&asset_out)?;
    let amount_in: i128 = amount_in.parse().map_err(|_| {
        ApiError::Internal(anyhow::anyhow!("invalid stored amount_in"))
    })?;

    // ── 3. Hold the source amount ─────────────────────────────────────────────
    let hold = state
        .ledger
        .hold(user_id_core, from_asset, Money::from_minor(amount_in))
        .await;

    let hold_id = match hold {
        Ok(h) => h,
        Err(e) => {
            sqlx::query("UPDATE conversions SET status = 'failed' WHERE id = $1")
                .bind(req.quote_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            return Err(ApiError::Internal(anyhow::anyhow!(
                "failed to hold funds: {e}"
            )));
        }
    };

    // ── 4. Settle: debit hold, credit target ──────────────────────────────────
    let settle = state
        .ledger
        .settle_convert(hold_id, user_id_core, to_asset, &amount_out)
        .await;

    match settle {
        Ok(()) => {
            sqlx::query("UPDATE conversions SET status = 'completed' WHERE id = $1")
                .bind(req.quote_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            Ok((
                StatusCode::OK,
                Json(ExecuteResponse {
                    conversion_id: req.quote_id,
                    status: "completed".to_string(),
                    amount_out,
                    to_asset,
                }),
            ))
        }
        Err(e) => {
            let _ = state.ledger.release(hold_id).await;
            sqlx::query("UPDATE conversions SET status = 'failed' WHERE id = $1")
                .bind(req.quote_id)
                .execute(&mut *tx)
                .await
                .map_err(db_error)?;
            tx.commit().await.map_err(db_error)?;
            Err(ApiError::Internal(anyhow::anyhow!(
                "failed to settle conversion: {e}"
            )))
        }
    }
}

fn db_error(e: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("database error: {e}"))
}
