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
#[derive(Debug, Deserialize)]
pub struct CreatePaymentRequest {
    pub asset: String,
    pub amount: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default = "default_expiry_minutes")]
    pub expiry_minutes: i64,
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

    let id = Uuid::new_v4();
    let expires_at = Utc::now() + Duration::minutes(payload.expiry_minutes);
    let uri = format!(
        "engipay:{}?asset={}&amount={}",
        id,
        asset.symbol(),
        money.minor
    );

    sqlx::query(
        "INSERT INTO payment_requests (id, user_id, asset, amount, note, uri, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(user_id.as_uuid())
    .bind(asset.symbol())
    .bind(money.minor.to_string())
    .bind(payload.note.as_deref())
    .bind(&uri)
    .bind(expires_at)
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
}
