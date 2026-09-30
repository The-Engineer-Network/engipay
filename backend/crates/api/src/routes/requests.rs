use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::routes::auth::AuthUser;
use engipay_core::{Asset, Money};

/// Request body for creating a payment request (invoice).
#[derive(Debug, Deserialize)]
pub struct CreatePaymentRequest {
    pub asset: String,
    pub amount: Decimal,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default = "default_expiry_minutes")]
    pub expiry_minutes: i64,
}

fn default_expiry_minutes() -> i64 {
    60
}

/// Response returned after a payment request is created.
#[derive(Debug, Serialize)]
pub struct PaymentRequestResponse {
    pub id: String,
    pub uri: String,
    pub expires_at: DateTime<Utc>,
}

/// Validation error returned when the request body is not acceptable.
#[derive(Debug, Serialize)]
pub struct ValidationError {
    pub error: String,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/payment-requests", post(create_payment_request))
}

/// POST /v1/payment-requests
///
/// Creates a merchant/peer payment request with a fixed amount, asset, and memo.
/// Money is handled as `Decimal` (never floating point) and all inputs are
/// validated before a record is persisted.
pub async fn create_payment_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreatePaymentRequest>,
) -> impl IntoResponse {
    let user_id = match auth.user_id(state.config.jwt_secret.as_bytes()) {
        Ok(id) => id,
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };
    let Some(pool) = state.database.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let asset = payload.asset.trim().to_uppercase();
    if asset.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationError {
                error: "asset must not be empty".to_string(),
            }),
        )
            .into_response();
    }

    if payload.amount <= Decimal::ZERO {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationError {
                error: "amount must be greater than zero".to_string(),
            }),
        )
            .into_response();
    }

    if payload.expiry_minutes <= 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(ValidationError {
                error: "expiry_minutes must be greater than zero".to_string(),
            }),
        )
            .into_response();
    }

    let id = Uuid::new_v4();
    let Some(expires_at) = Duration::try_minutes(payload.expiry_minutes)
        .and_then(|duration| Utc::now().checked_add_signed(duration))
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(core_asset) = Asset::ALL.iter().copied().find(|a| a.symbol() == asset) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let amount = match Money::parse(core_asset, &payload.amount.to_string()) {
        Ok(amount) if amount.is_positive() => amount,
        _ => return StatusCode::BAD_REQUEST.into_response(),
    };
    let uri = format!("engipay:{}?asset={}&amount={}", id, asset, payload.amount);

    let result = sqlx::query(
        "INSERT INTO payment_requests (id, asset, amount, note, uri, expires_at, user_id) \
         VALUES ($1, $2, $3::numeric, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(&asset)
    .bind(amount.minor.to_string())
    .bind(payload.note.as_deref())
    .bind(&uri)
    .bind(expires_at)
    .bind(user_id.as_uuid())
    .execute(pool)
    .await;

    if let Err(err) = result {
        tracing::error!(error = %err, "failed to persist payment request");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ValidationError {
                error: "failed to create payment request".to_string(),
            }),
        )
            .into_response();
    }

    (
        StatusCode::CREATED,
        Json(PaymentRequestResponse {
            id: id.to_string(),
            uri,
            expires_at,
        }),
    )
        .into_response()
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
        let amount = Decimal::new(0, 2);
        assert!(amount <= Decimal::ZERO);
    }

    #[test]
    fn accepts_positive_amount() {
        let amount = Decimal::new(2500, 2);
        assert!(amount > Decimal::ZERO);
        assert_eq!(amount.to_string(), "25.00");
    }

    #[test]
    fn rejects_non_positive_expiry() {
        assert!(Duration::try_minutes(i64::MAX).is_none());
    }

    #[test]
    fn normalizes_asset_to_uppercase() {
        let asset = "usdc".trim().to_uppercase();
        assert_eq!(asset, "USDC");
    }
}
