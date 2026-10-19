use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use engipay_core::{Asset, Money};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

/// Request body for creating a payment request (invoice).
///
/// `amount` is a decimal **string**, never a JSON number: the value is parsed
/// into [`Money`] (integer minor units) so no floating-point rounding can ever
/// reach the ledger.
///
/// `allow_partial` allows the request to be settled with multiple payments.
/// `min_amount` caps the minimum size of each individual payment (must be
/// positive and ≤ the requested amount).
/// `max_amount` caps the maximum size of each individual payment (must be ≥
/// `min_amount` when both are set).
#[derive(Debug, Deserialize)]
pub struct CreatePaymentRequest {
    pub asset: String,
    pub amount: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default = "default_expiry_minutes")]
    pub expiry_minutes: i64,
    /// When `true`, the request may be fulfilled by several smaller payments.
    #[serde(default)]
    pub allow_partial: bool,
    /// Minimum single-payment amount as a decimal string (same units as `amount`).
    #[serde(default)]
    pub min_amount: Option<String>,
    /// Maximum single-payment amount as a decimal string.
    #[serde(default)]
    pub max_amount: Option<String>,
}

fn default_expiry_minutes() -> i64 {
    60
}

/// An invoice must be valid for at least a minute and at most a year, so a
/// typo cannot mint an already-expired or effectively permanent request.
fn validate_expiry_minutes(minutes: i64) -> Result<(), ApiError> {
    if !(1..=525_600).contains(&minutes) {
        return Err(ApiError::BadRequest(
            "expiry_minutes must be between 1 and 525600".to_string(),
        ));
    }
    Ok(())
}

/// Response returned after a payment request is created.
#[derive(Debug, Serialize)]
pub struct PaymentRequestResponse {
    pub id: String,
    pub uri: String,
    pub expires_at: DateTime<Utc>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/payment-requests", post(create_payment_request))
}

/// POST /v1/payment-requests
///
/// Creates a merchant/peer payment request with a fixed amount, asset, and memo.
/// Money is handled as integer minor units (never floating point) and all inputs
/// are validated before a record is persisted.
pub async fn create_payment_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreatePaymentRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let asset_str = payload.asset.trim().to_uppercase();
    let asset: Asset = asset_str
        .parse()
        .map_err(|_| ApiError::BadRequest("unsupported asset".to_string()))?;

    // Exact decimal parse into minor units; rejects zero, negatives and more
    // fractional digits than the asset has.
    let money = Money::parse(asset, payload.amount.trim())
        .map_err(|_| ApiError::BadRequest("amount must be a positive value".to_string()))?;
    if money.minor <= 0 {
        return Err(ApiError::BadRequest(
            "amount must be greater than zero".to_string(),
        ));
    }

    if payload.expiry_minutes <= 0 {
        return Err(ApiError::BadRequest(
            "expiry_minutes must be greater than zero".to_string(),
        ));
    }
    validate_expiry_minutes(payload.expiry_minutes)?;

    // Parse and validate partial payment bounds.
    let min_amount_minor: Option<i128> = payload
        .min_amount
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            let m = Money::parse(asset, s)
                .map_err(|_| ApiError::BadRequest("min_amount must be a positive value".to_string()))?;
            if m.minor <= 0 {
                return Err(ApiError::BadRequest(
                    "min_amount must be greater than zero".to_string(),
                ));
            }
            if m.minor > money.minor {
                return Err(ApiError::BadRequest(
                    "min_amount must not exceed the requested amount".to_string(),
                ));
            }
            Ok(m.minor)
        })
        .transpose()?;

    let max_amount_minor: Option<i128> = payload
        .max_amount
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            let m = Money::parse(asset, s)
                .map_err(|_| ApiError::BadRequest("max_amount must be a positive value".to_string()))?;
            if m.minor <= 0 {
                return Err(ApiError::BadRequest(
                    "max_amount must be greater than zero".to_string(),
                ));
            }
            Ok(m.minor)
        })
        .transpose()?;

    // max_amount must be >= min_amount when both are present.
    if let (Some(min), Some(max)) = (min_amount_minor, max_amount_minor) {
        if max < min {
            return Err(ApiError::BadRequest(
                "max_amount must be greater than or equal to min_amount".to_string(),
            ));
        }
    }

    // max_amount must not exceed the total requested amount.
    if let Some(max) = max_amount_minor {
        if max > money.minor {
            return Err(ApiError::BadRequest(
                "max_amount must not exceed the requested amount".to_string(),
            ));
        }
    }

    let id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::minutes(payload.expiry_minutes);
    let uri = format!(
        "engipay:{}?asset={}&amount={}",
        id,
        asset.symbol(),
        money.minor
    );

    // Write both the 0001 columns (user_id, amount) and the 0009 invoicing
    // columns (recipient_id, requested_amount) so either API generation can
    // read back the row without violating the NOT NULL constraints.
    // $2 and $4 are reused for (user_id, recipient_id) and (amount, requested_amount).
    sqlx::query(
        "INSERT INTO payment_requests \
            (id, user_id, asset, amount, note, uri, expires_at, \
             recipient_id, requested_amount, allow_partial, min_amount, max_amount) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $2, $4, $8, $9, $10)",
    )
    .bind(id)
    .bind(user_id.as_uuid())
    .bind(asset.symbol())
    .bind(money.minor.to_string())
    .bind(payload.note.as_deref())
    .bind(&uri)
    .bind(expires_at)
    .bind(payload.allow_partial)
    .bind(min_amount_minor.map(|v| v.to_string()))
    .bind(max_amount_minor.map(|v| v.to_string()))
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok((
        StatusCode::CREATED,
        Json(PaymentRequestResponse {
            id: id.to_string(),
            uri,
            expires_at,
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_expiry_is_one_hour() {
        assert_eq!(default_expiry_minutes(), 60);
    }

    #[test]
    fn rejects_non_positive_amount() {
        assert!(Money::parse(Asset::Usdc, "0").unwrap().minor <= 0);
        assert!(Money::parse(Asset::Usdc, "-1").is_err());
    }

    #[test]
    fn accepts_positive_amount() {
        let money = Money::parse(Asset::Usdc, "25.00").unwrap();
        assert!(money.minor > 0);
        assert_eq!(money.minor, 250_000_000);
    }

    #[test]
    fn rejects_non_positive_expiry() {
        assert!(validate_expiry_minutes(0).is_err());
        assert!(validate_expiry_minutes(-5).is_err());
    }

    #[test]
    fn accepts_expiry_within_bounds() {
        assert!(validate_expiry_minutes(1).is_ok());
        assert!(validate_expiry_minutes(60).is_ok());
        assert!(validate_expiry_minutes(525_600).is_ok());
        assert!(validate_expiry_minutes(525_601).is_err());
    }

    #[test]
    fn normalizes_asset_to_uppercase() {
        let asset = "usdc".trim().to_uppercase();
        assert_eq!(asset, "USDC");
    }

    #[test]
    fn min_amount_must_not_exceed_requested() {
        // min > amount: should be rejected
        let min = Money::parse(Asset::Usdc, "100.00").unwrap();
        let amount = Money::parse(Asset::Usdc, "50.00").unwrap();
        assert!(min.minor > amount.minor);
    }

    #[test]
    fn max_amount_must_be_gte_min_amount() {
        let min = Money::parse(Asset::Usdc, "10.00").unwrap();
        let max = Money::parse(Asset::Usdc, "5.00").unwrap();
        assert!(max.minor < min.minor);
    }
}
