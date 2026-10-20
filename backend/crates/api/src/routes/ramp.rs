//! Naira ramp endpoints: quote, and partner webhook receiver.
//!
//! # POST /v1/ramp/quote
//!
//! Gets a price quote from the configured ramp partner for a given asset and
//! amount. Quotes are stored in `ramp_orders` with status `quoted` and an
//! expiry time so an order can later reference them.
//!
//! # POST /v1/ramp/webhook
//!
//! Receives and verifies a partner webhook callback. The partner sends a
//! signed HTTP POST whenever an order status changes. The handler:
//!
//! 1. Verifies the signature over the raw body.
//! 2. Inserts into `webhook_events` — duplicate `event_id` is acknowledged
//!    and exits without further action (idempotency).
//! 3. Finds the matching `ramp_orders` row by `partner_ref`.
//! 4. Updates `ramp_orders.status`.
//! 5. If the order is now `completed`, credits the user via the ledger exactly
//!    once (the `webhook_events` unique index guarantees this).

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::ramp_partner::{Direction, RampError};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/ramp/quote", post(create_quote))
        .route("/ramp/webhook", post(receive_webhook))
}

// ── Request / response types ──────────────────────────────────────────────────

/// `POST /v1/ramp/quote` body.
#[derive(Debug, Deserialize)]
pub struct QuoteRequest {
    pub direction: Direction,
    pub asset: Asset,
    /// Amount of crypto, as an exact decimal string (e.g. "10.0000000").
    /// Must have no more decimal places than the asset supports.
    pub crypto_amount: String,
}

/// Quote response.
#[derive(Debug, Serialize)]
pub struct QuoteResponse {
    pub id: Uuid,
    pub direction: Direction,
    pub asset: Asset,
    /// Exact decimal string with the asset's precision.
    pub crypto_amount: String,
    /// NGN paid (on-ramp) or received (off-ramp), in kobo.
    pub ngn_kobo: String,
    /// Exchange rate: kobo per whole unit.
    pub rate_kobo_per_unit: String,
    /// Fee in the asset's smallest unit.
    pub fee_minor: String,
    /// Opaque partner reference for this quote.
    pub partner_quote_id: String,
    /// RFC 3339 expiry.
    pub expires_at: String,
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

    let crypto_minor =
        parse_crypto_amount(&req.crypto_amount, req.asset.decimals()).ok_or_else(|| {
            ApiError::BadRequest(format!(
                "crypto_amount must be a decimal with at most {} decimal places",
                req.asset.decimals()
            ))
        })?;

    if crypto_minor <= 0 {
        return Err(ApiError::BadRequest(
            "crypto_amount must be positive".to_owned(),
        ));
    }

    let quote = state
        .ramp_partner
        .quote(req.direction, req.asset, crypto_minor)
        .map_err(ramp_error)?;

    // Store the quote so an order can reference it later.
    let row = sqlx::query(
        r#"INSERT INTO ramp_orders
               (id, user_id, direction, asset, crypto_amount, ngn_amount,
                rate, fee, partner, partner_ref, status, expires_at)
           VALUES (
               gen_random_uuid(), $1, $2, $3,
               $4::numeric, $5::numeric,
               $6::numeric, $7::numeric,
               $8, $9, 'quoted',
               to_timestamp($10::bigint)
           )
           RETURNING id,
                     to_char(expires_at AT TIME ZONE 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at_str"#,
    )
    .bind(user_id)
    .bind(quote.direction.as_db_str())
    .bind(req.asset.symbol())
    .bind(quote.crypto_minor.to_string())
    .bind(kobo_to_ngn_str(quote.ngn_kobo))
    .bind(quote.rate_kobo_per_unit.to_string())
    .bind(quote.fee_minor.to_string())
    .bind(state.ramp_partner.name())
    .bind(&quote.partner_quote_id)
    .bind(quote.expires_at)
    .fetch_one(db)
    .await
    .map_err(db_error)?;

    let id: Uuid = row.try_get("id").map_err(db_error)?;
    let expires_at: String = row.try_get("expires_at_str").map_err(db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(QuoteResponse {
            id,
            direction: quote.direction,
            asset: req.asset,
            crypto_amount: format_fixed(quote.crypto_minor, req.asset.decimals()),
            ngn_kobo: quote.ngn_kobo.to_string(),
            rate_kobo_per_unit: quote.rate_kobo_per_unit.to_string(),
            fee_minor: quote.fee_minor.to_string(),
            partner_quote_id: quote.partner_quote_id,
            expires_at,
        }),
    ))
}

async fn receive_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // The partner sends its signature in X-Ramp-Signature. Real partners use
    // their own header name; a real implementation reads the right one here.
    let sig = headers
        .get("x-ramp-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let event = state
        .ramp_partner
        .verify_webhook_signature(&body, sig)
        .map_err(|e| match e {
            RampError::InvalidSignature => ApiError::Unauthorized("invalid signature".to_owned()),
            RampError::MalformedPayload(m) => ApiError::BadRequest(m),
            other => ApiError::Internal(anyhow::anyhow!("webhook error: {other}")),
        })?;

    // Idempotency: insert the event. If `event_id` already exists for this
    // provider the ON CONFLICT does nothing and we return 200.
    let provider = state.ramp_partner.name();
    let inserted: Option<_> = sqlx::query(
        "INSERT INTO webhook_events (id, provider, event_id, payload)
         VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id",
    )
    .bind(provider)
    .bind(&event.event_id)
    .bind(event.raw_payload.to_string())
    .fetch_optional(db)
    .await
    .map_err(db_error)?;

    if inserted.is_none() {
        // Already processed — acknowledge and do nothing.
        return Ok(StatusCode::OK);
    }

    // Find the ramp order by partner_ref.
    let order_row = sqlx::query(
        "SELECT id, user_id, asset, crypto_amount::text, status
         FROM ramp_orders
         WHERE partner = $1 AND partner_ref = $2",
    )
    .bind(provider)
    .bind(&event.partner_ref)
    .fetch_optional(db)
    .await
    .map_err(db_error)?;

    let Some(order) = order_row else {
        // Unknown partner_ref; we accepted the event but have nothing to update.
        return Ok(StatusCode::OK);
    };

    let order_id: Uuid = order.try_get("id").map_err(db_error)?;
    let user_id_raw: Uuid = order.try_get("user_id").map_err(db_error)?;
    let asset_str: String = order.try_get("asset").map_err(db_error)?;
    let crypto_amount_str: String = order.try_get("crypto_amount").map_err(db_error)?;
    let current_status: String = order.try_get("status").map_err(db_error)?;

    let new_status = event.new_status.as_db_str();

    // Update the order status.
    sqlx::query("UPDATE ramp_orders SET status = $1 WHERE id = $2")
        .bind(new_status)
        .bind(order_id)
        .execute(db)
        .await
        .map_err(db_error)?;

    // Credit the user's ledger if the order just completed.
    if event.new_status == crate::services::ramp_partner::RampOrderStatus::Completed
        && current_status != "completed"
    {
        let asset: Asset = asset_str.parse().map_err(|_| {
            ApiError::Internal(anyhow::anyhow!("unknown asset in ramp_order: {asset_str}"))
        })?;
        let crypto_minor: i128 = crypto_amount_str.parse().map_err(|_| {
            ApiError::Internal(anyhow::anyhow!(
                "could not parse crypto_amount: {crypto_amount_str}"
            ))
        })?;
        let user = UserId::from_uuid(user_id_raw);
        let money = Money {
            asset,
            minor: crypto_minor,
        };
        let reference = format!("ramp:{provider}:{}", event.event_id);
        let ledger = PostgresLedgerStore::new(db.clone());
        ledger
            .deposit(user, money, &reference)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("ledger error: {e}")))?;
    }

    Ok(StatusCode::OK)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Parse a decimal string like "10.0000000" into the asset's minor units.
/// Returns `None` if the string has more decimal places than the asset supports,
/// contains non-digit characters, or is empty.
fn parse_crypto_amount(input: &str, decimals: u32) -> Option<i64> {
    let trimmed = input.trim();
    let (whole, frac) = match trimmed.split_once('.') {
        Some((w, f)) => (w, f),
        None => (trimmed, ""),
    };

    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    // A dot must be followed by at least one digit: "5." is not valid.
    if trimmed.contains('.') && frac.is_empty() {
        return None;
    }
    if !frac.is_empty() && !frac.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let frac_len = u32::try_from(frac.len()).ok()?;
    if frac_len > decimals {
        return None;
    }
    let pad = decimals - frac_len;
    let whole_val: i64 = whole.parse().ok()?;
    let scale = 10i64.pow(decimals);
    let frac_padded: i64 = if frac.is_empty() {
        0
    } else {
        let v: i64 = frac.parse().ok()?;
        v.checked_mul(10i64.pow(pad))?
    };
    whole_val.checked_mul(scale)?.checked_add(frac_padded)
}

/// Format an integer minor amount as a fixed-point decimal string.
fn format_fixed(minor: i64, decimals: u32) -> String {
    let scale = 10i64.pow(decimals);
    if decimals == 0 {
        return minor.to_string();
    }
    let abs = minor.abs();
    let sign = if minor < 0 { "-" } else { "" };
    format!(
        "{sign}{}.{:0width$}",
        abs / scale,
        abs % scale,
        width = decimals as usize
    )
}

/// Convert kobo (i64) to a NGN decimal string for storage in `ngn_amount NUMERIC(18,2)`.
fn kobo_to_ngn_str(kobo: i64) -> String {
    let abs = kobo.abs();
    let sign = if kobo < 0 { "-" } else { "" };
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}

fn ramp_error(e: RampError) -> ApiError {
    match e {
        RampError::UnsupportedAsset { asset, direction } => ApiError::BadRequest(format!(
            "{asset} is not supported for {direction:?}"
        )),
        RampError::PartnerRejected(m) => ApiError::BadRequest(m),
        RampError::PartnerUnavailable(m) => ApiError::Unavailable(m),
        RampError::InvalidSignature => ApiError::Unauthorized("invalid signature".to_owned()),
        RampError::MalformedPayload(m) => ApiError::BadRequest(m),
    }
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("ramp database error: {error}"))
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn parse_crypto_amount_exact_integer() {
        assert_eq!(parse_crypto_amount("10", 7), Some(100_000_000));
        assert_eq!(parse_crypto_amount("0", 7), Some(0));
    }

    #[test]
    fn parse_crypto_amount_with_fractional() {
        assert_eq!(parse_crypto_amount("10.0000000", 7), Some(100_000_000));
        assert_eq!(parse_crypto_amount("1.5000000", 7), Some(15_000_000));
        assert_eq!(parse_crypto_amount("0.0000001", 7), Some(1));
    }

    #[test]
    fn parse_crypto_amount_too_many_decimals_is_refused() {
        assert_eq!(parse_crypto_amount("1.00000001", 7), None); // 8 dp for 7-dp asset
    }

    #[test]
    fn parse_crypto_amount_non_numeric_is_refused() {
        assert_eq!(parse_crypto_amount("abc", 7), None);
        assert_eq!(parse_crypto_amount("", 7), None);
        assert_eq!(parse_crypto_amount("1e7", 7), None);
    }

    #[test]
    fn format_fixed_produces_correct_string() {
        assert_eq!(format_fixed(10_000_000, 7), "1.0000000");
        assert_eq!(format_fixed(1, 7), "0.0000001");
        assert_eq!(format_fixed(100_000_000, 7), "10.0000000");
    }

    #[test]
    fn kobo_to_ngn_str_converts_correctly() {
        assert_eq!(kobo_to_ngn_str(150_000), "1500.00");
        assert_eq!(kobo_to_ngn_str(1), "0.01");
        assert_eq!(kobo_to_ngn_str(100), "1.00");
    }
}
