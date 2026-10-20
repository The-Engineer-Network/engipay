//! Naira buy quotes and orders.
//!
//! A quote prices a buy from configured terms and is valid for a short time.
//! An order is created from a live quote, once. Orders wait in
//! `awaiting_partner` because no Naira partner is connected yet: no payment is
//! taken, no payment instructions are issued and the ledger is not touched.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use engipay_core::Asset;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::buy::{self, QUOTE_LIFETIME_SQL, Terms};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/buy/quotes", post(create_quote))
        .route("/buy/orders", post(create_order))
}

const NOT_CONFIGURED: &str = "Buying with Naira is not available yet: pricing has not been set up.";

// ── Request / response types ──────────────────────────────────────────────────

/// `POST /v1/buy/quotes` body.
#[derive(Debug, Deserialize)]
pub struct QuoteRequest {
    /// Naira the user pays, as typed: "5000" or "5,000.50".
    pub naira_amount: String,
    pub asset: Asset,
}

/// A priced buy. Money fields are integer strings so no precision is lost.
#[derive(Debug, Serialize)]
pub struct QuoteResponse {
    pub id: Uuid,
    pub asset: Asset,
    /// Naira paid, in kobo.
    pub naira_kobo: String,
    /// Fee taken from the Naira, in kobo.
    pub fee_kobo: String,
    /// Asset the user receives, as a fixed-point decimal.
    pub receive: String,
    pub receive_decimals: u32,
    /// Kobo per whole unit of the asset at this quote.
    pub kobo_per_unit: String,
    /// RFC 3339 instant after which the quote can no longer be used.
    pub expires_at: String,
}

/// `POST /v1/buy/orders` body.
#[derive(Debug, Deserialize)]
pub struct OrderRequest {
    pub quote_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct OrderResponse {
    pub id: Uuid,
    pub quote_id: Uuid,
    pub status: &'static str,
    pub message: &'static str,
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

    // No rate or fee configured means no quote. The rate is never invented.
    let (Some(kobo_per_unit), Some(fee_bps)) =
        (state.config.buy_kobo_per_usdc, state.config.buy_fee_bps)
    else {
        return Err(ApiError::Unavailable(NOT_CONFIGURED.to_string()));
    };

    if req.asset != Asset::Usdc {
        return Err(ApiError::BadRequest(
            "Only USDC can be bought for now.".to_string(),
        ));
    }

    let naira_kobo = buy::parse_naira_to_kobo(&req.naira_amount).ok_or_else(|| {
        ApiError::BadRequest("Enter a Naira amount such as 5000 or 5000.50.".to_string())
    })?;

    let terms = Terms {
        kobo_per_unit,
        fee_bps,
    };
    let priced = buy::price(naira_kobo, terms, Asset::Usdc.decimals()).ok_or_else(|| {
        ApiError::BadRequest("This amount is too small to buy any USDC.".to_string())
    })?;

    let row = sqlx::query(
        r#"INSERT INTO buy_quotes
               (user_id, asset, naira_kobo, fee_kobo, receive_minor, kobo_per_unit, fee_bps, expires_at)
           VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6::numeric, $7, now() + $8::interval)
           RETURNING id,
                     to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at"#,
    )
    .bind(user_id)
    .bind(Asset::Usdc.symbol())
    .bind(priced.naira_kobo.to_string())
    .bind(priced.fee_kobo.to_string())
    .bind(priced.receive_minor.to_string())
    .bind(kobo_per_unit.to_string())
    .bind(i32::try_from(fee_bps).map_err(|_| ApiError::Unavailable(NOT_CONFIGURED.to_string()))?)
    .bind(QUOTE_LIFETIME_SQL)
    .fetch_one(db)
    .await
    .map_err(db_error)?;

    let response = QuoteResponse {
        id: row.try_get("id").map_err(db_error)?,
        asset: Asset::Usdc,
        naira_kobo: priced.naira_kobo.to_string(),
        fee_kobo: priced.fee_kobo.to_string(),
        receive: buy::format_fixed(priced.receive_minor, Asset::Usdc.decimals()),
        receive_decimals: Asset::Usdc.decimals(),
        kobo_per_unit: kobo_per_unit.to_string(),
        expires_at: row.try_get("expires_at").map_err(db_error)?,
    };
    Ok((StatusCode::CREATED, Json(response)))
}

async fn create_order(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<OrderRequest>,
) -> Result<(StatusCode, Json<OrderResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // One transaction: lock the quote, check it is live and unused, then record
    // the order. Returning early drops the transaction and rolls it back.
    let mut tx = db.begin().await.map_err(db_error)?;

    let quote = sqlx::query(
        "SELECT expires_at > now() AS live FROM buy_quotes WHERE id = $1 AND user_id = $2 FOR UPDATE",
    )
    .bind(req.quote_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?
    .ok_or(ApiError::NotFound)?;

    let live: bool = quote.try_get("live").map_err(db_error)?;
    if !live {
        return Err(ApiError::Conflict(
            "This quote has expired. Get a new quote.".to_string(),
        ));
    }

    let inserted = sqlx::query(
        "INSERT INTO buy_orders (quote_id, user_id) VALUES ($1, $2) \
         ON CONFLICT (quote_id) DO NOTHING RETURNING id",
    )
    .bind(req.quote_id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;

    let Some(row) = inserted else {
        return Err(ApiError::Conflict(
            "This quote has already been used for an order.".to_string(),
        ));
    };
    let id: Uuid = row.try_get("id").map_err(db_error)?;
    tx.commit().await.map_err(db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(OrderResponse {
            id,
            quote_id: req.quote_id,
            status: "awaiting_partner",
            message: "Your order is saved. Payment instructions will appear here once a Naira partner is connected. No money has been taken.",
        }),
    ))
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("buy database error: {error}"))
}
