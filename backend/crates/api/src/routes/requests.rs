//! `POST /v1/payment-requests`: the caller asks to be paid a fixed amount.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use chrono::{DateTime, Duration, Utc};
use engipay_core::{Asset, Money};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

/// The longest a payment request may stay open: one week.
const MAX_EXPIRY_MINUTES: i64 = 7 * 24 * 60;

/// Request body for creating a payment request (invoice).
#[derive(Debug, Deserialize)]
pub struct CreatePaymentRequest {
    pub asset: Asset,
    /// Decimal amount at the asset's precision, e.g. `"25.00"`. Never a float.
    pub amount: String,
    #[serde(default = "default_expiry_minutes")]
    pub expiry_minutes: i64,
}

fn default_expiry_minutes() -> i64 {
    60
}

/// Response returned after a payment request is created.
#[derive(Debug, Serialize)]
pub struct PaymentRequestResponse {
    pub id: Uuid,
    pub uri: String,
    pub expires_at: DateTime<Utc>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/payment-requests", post(create_payment_request))
}

/// Checks the body and returns the exact amount and the expiry window.
pub fn validate(payload: &CreatePaymentRequest) -> Result<(Money, Duration), ApiError> {
    let money = Money::parse(payload.asset, &payload.amount)
        .map_err(|_| ApiError::BadRequest("amount is not a valid decimal for this asset".into()))?;
    if !money.is_positive() {
        return Err(ApiError::BadRequest(
            "amount must be greater than zero".into(),
        ));
    }
    if !(1..=MAX_EXPIRY_MINUTES).contains(&payload.expiry_minutes) {
        return Err(ApiError::BadRequest(format!(
            "expiry_minutes must be between 1 and {MAX_EXPIRY_MINUTES}"
        )));
    }
    Ok((money, Duration::minutes(payload.expiry_minutes)))
}

/// The shareable link a payer opens to settle the request.
pub fn payment_uri(id: Uuid, money: Money) -> String {
    format!(
        "engipay:{id}?asset={}&amount={}",
        money.asset.symbol(),
        money.decimal()
    )
}

async fn create_payment_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CreatePaymentRequest>,
) -> Result<(StatusCode, Json<PaymentRequestResponse>), ApiError> {
    let recipient = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let (money, expiry) = validate(&payload)?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let id = Uuid::new_v4();
    let expires_at = Utc::now()
        .checked_add_signed(expiry)
        .ok_or_else(|| ApiError::BadRequest("expiry is out of range".into()))?;

    let uri = payment_uri(id, money);
    sqlx::query(
        "INSERT INTO payment_requests (id, recipient_id, requested_amount, asset, uri, expires_at) \
         VALUES ($1, $2, $3::NUMERIC, $4, $5, $6)",
    )
    .bind(id)
    .bind(recipient.as_uuid())
    .bind(money.minor.to_string())
    .bind(money.asset.symbol())
    .bind(&uri)
    .bind(expires_at)
    .execute(pool)
    .await
    .map_err(|error| ApiError::Internal(error.into()))?;

    Ok((
        StatusCode::CREATED,
        Json(PaymentRequestResponse {
            id,
            uri,
            expires_at,
        }),
    ))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn payload(amount: &str, expiry_minutes: i64) -> CreatePaymentRequest {
        CreatePaymentRequest {
            asset: Asset::Usdc,
            amount: amount.to_owned(),
            expiry_minutes,
        }
    }

    #[test]
    fn default_expiry_is_one_hour() {
        assert_eq!(default_expiry_minutes(), 60);
    }

    #[test]
    fn accepts_a_positive_amount() {
        let (money, expiry) = validate(&payload("25.00", 60)).unwrap();
        assert_eq!(money, Money::parse(Asset::Usdc, "25").unwrap());
        assert_eq!(expiry, Duration::minutes(60));
    }

    #[test]
    fn rejects_zero_negative_and_garbage_amounts() {
        for amount in ["0", "-1", "abc", "1.00000001"] {
            assert!(validate(&payload(amount, 60)).is_err(), "{amount:?}");
        }
    }

    #[test]
    fn rejects_an_out_of_range_expiry() {
        assert!(validate(&payload("1", 0)).is_err());
        assert!(validate(&payload("1", -5)).is_err());
        assert!(validate(&payload("1", MAX_EXPIRY_MINUTES + 1)).is_err());
        assert!(validate(&payload("1", MAX_EXPIRY_MINUTES)).is_ok());
    }

    #[test]
    fn the_uri_carries_the_exact_amount() {
        let id = Uuid::nil();
        let money = Money::parse(Asset::Usdc, "25").unwrap();
        assert_eq!(
            payment_uri(id, money),
            format!("engipay:{id}?asset=USDC&amount=25")
        );
    }
}
