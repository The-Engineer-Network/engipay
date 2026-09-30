use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::AppState;
use crate::middleware::VelocityLimiter;
use crate::routes::auth::AuthUser;

/// A validated request to create an internal transfer.
///
/// Money is never represented as a floating point value: `amount` is kept as a
/// string and validated to be a positive integer number of minor units with
/// exact decimal precision.
#[derive(Debug, Clone, Deserialize)]
pub struct TransferRequest {
    pub recipient: String,
    pub asset: Asset,
    pub amount: String,
    pub reference: String,
}

/// Supported assets for transfers. Reuses the core asset identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Asset {
    Usd,
    Eur,
    Gbp,
}

/// Validation failures for a [`TransferRequest`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferRequestError {
    EmptyRecipient,
    InvalidAmount,
    NonPositiveAmount,
    OverPreciseAmount,
    InvalidReference,
}

impl TransferRequest {
    /// Validate the request, returning the normalized recipient on success.
    pub fn validate(&self) -> Result<(), TransferRequestError> {
        if self.recipient.trim().is_empty() {
            return Err(TransferRequestError::EmptyRecipient);
        }

        validate_amount(&self.amount)?;

        let reference_len = self.reference.chars().count();
        if reference_len == 0 || reference_len > 64 {
            return Err(TransferRequestError::InvalidReference);
        }

        Ok(())
    }
}

/// Validate that `amount` is a positive integer number of minor units with
/// exact decimal precision (no floating point, no over-precision fractions).
fn validate_amount(amount: &str) -> Result<(), TransferRequestError> {
    let trimmed = amount.trim();
    if trimmed.is_empty() {
        return Err(TransferRequestError::InvalidAmount);
    }

    let (integer_part, fraction_part) = match trimmed.split_once('.') {
        Some((int, frac)) => (int, Some(frac)),
        None => (trimmed, None),
    };

    if integer_part.is_empty() || !integer_part.chars().all(|c| c.is_ascii_digit()) {
        return Err(TransferRequestError::InvalidAmount);
    }

    if let Some(frac) = fraction_part {
        if frac.is_empty() || !frac.chars().all(|c| c.is_ascii_digit()) {
            return Err(TransferRequestError::InvalidAmount);
        }
        // Minor units are integers: any fractional part is over-precision.
        if frac.chars().any(|c| c != '0') {
            return Err(TransferRequestError::OverPreciseAmount);
        }
    }

    let minor_units: u128 = integer_part
        .parse()
        .map_err(|_| TransferRequestError::InvalidAmount)?;

    if minor_units == 0 {
        return Err(TransferRequestError::NonPositiveAmount);
    }

    Ok(())
}

lazy_static::lazy_static! {
    static ref VELOCITY_LIMITER: VelocityLimiter = VelocityLimiter::new();
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/transfers", post(create_transfer))
}

async fn create_transfer(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<TransferRequest>,
) -> impl IntoResponse {
    let user_id = match auth.user_id(state.config.jwt_secret.as_bytes()) {
        Ok(id) => id.to_string(),
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };

    if let Err((status, msg)) = VELOCITY_LIMITER.check_sensitive_action(&user_id).await {
        return (status, msg).into_response();
    }

    match request.validate() {
        Ok(()) => StatusCode::ACCEPTED.into_response(),
        Err(_) => StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(recipient: &str, amount: &str, reference: &str) -> TransferRequest {
        TransferRequest {
            recipient: recipient.to_string(),
            asset: Asset::Usd,
            amount: amount.to_string(),
            reference: reference.to_string(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        let req = request("alice", "100", "ref-1");
        assert_eq!(req.validate(), Ok(()));
    }

    #[test]
    fn rejects_empty_recipient() {
        let req = request("   ", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::EmptyRecipient));
    }

    #[test]
    fn rejects_negative_amount() {
        let req = request("alice", "-100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_zero_amount() {
        let req = request("alice", "0", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::NonPositiveAmount));
    }

    #[test]
    fn rejects_over_precision_amount() {
        let req = request("alice", "100.5", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::OverPreciseAmount));
    }

    #[test]
    fn rejects_non_numeric_amount() {
        let req = request("alice", "abc", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_empty_reference() {
        let req = request("alice", "100", "");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn rejects_overlong_reference() {
        let req = request("alice", "100", &"x".repeat(65));
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }
}
