use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::AppState;

/// A validated request to create an internal transfer.
///
/// Money is never represented as a floating point value: `amount` is kept as a
/// string and validated to be a positive integer number of minor units with
/// exact decimal precision.
#[derive(Debug, Clone, Deserialize)]
pub struct TransferRequest {
    pub sender: String,
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
    EmptySender,
    EmptyRecipient,
    InvalidAmount,
    NonPositiveAmount,
    OverPreciseAmount,
    InvalidReference,
}

impl TransferRequest {
    /// Validate the request, returning the normalized recipient on success.
    pub fn validate(&self) -> Result<(), TransferRequestError> {
        if self.sender.trim().is_empty() {
            return Err(TransferRequestError::EmptySender);
        }

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

    /// Parse the validated `amount` into an exact integer number of minor units.
    ///
    /// Callers must run [`TransferRequest::validate`] first; this only performs
    /// the lossless conversion and never uses floating point arithmetic.
    pub fn amount_minor_units(&self) -> Result<u128, TransferRequestError> {
        validate_amount(&self.amount)?;
        let integer_part = self
            .amount
            .trim()
            .split_once('.')
            .map(|(int, _)| int)
            .unwrap_or_else(|| self.amount.trim());
        integer_part
            .parse()
            .map_err(|_| TransferRequestError::InvalidAmount)
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

pub fn routes() -> Router<AppState> {
    Router::new().route("/v1/transfers", post(create_transfer))
}

async fn create_transfer(
    State(state): State<AppState>,
    Json(request): Json<TransferRequest>,
) -> impl IntoResponse {
    if request.validate().is_err() {
        return StatusCode::UNPROCESSABLE_ENTITY;
    }

    let amount = match request.amount_minor_units() {
        Ok(amount) => amount,
        Err(_) => return StatusCode::UNPROCESSABLE_ENTITY,
    };

    // Execute the atomic ledger transfer inside a database transaction. The
    // idempotency reference is the caller-supplied `reference`, so retries of
    // the same request do not double-spend.
    let result = state
        .ledger
        .transfer(
            &request.sender,
            &request.recipient,
            amount,
            &request.reference,
        )
        .await;

    match result {
        Ok(_) => StatusCode::CREATED,
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(sender: &str, recipient: &str, amount: &str, reference: &str) -> TransferRequest {
        TransferRequest {
            sender: sender.to_string(),
            recipient: recipient.to_string(),
            asset: Asset::Usd,
            amount: amount.to_string(),
            reference: reference.to_string(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        let req = request("bob", "alice", "100", "ref-1");
        assert_eq!(req.validate(), Ok(()));
    }

    #[test]
    fn rejects_empty_sender() {
        let req = request("   ", "alice", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::EmptySender));
    }

    #[test]
    fn rejects_empty_recipient() {
        let req = request("bob", "   ", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::EmptyRecipient));
    }

    #[test]
    fn rejects_negative_amount() {
        let req = request("bob", "alice", "-100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_zero_amount() {
        let req = request("bob", "alice", "0", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::NonPositiveAmount));
    }

    #[test]
    fn rejects_over_precision_amount() {
        let req = request("bob", "alice", "100.5", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::OverPreciseAmount));
    }

    #[test]
    fn rejects_non_numeric_amount() {
        let req = request("bob", "alice", "abc", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_empty_reference() {
        let req = request("bob", "alice", "100", "");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn rejects_overlong_reference() {
        let req = request("bob", "alice", "100", &"x".repeat(65));
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn parses_amount_into_minor_units() {
        let req = request("bob", "alice", "100", "ref-1");
        assert_eq!(req.amount_minor_units(), Ok(100));
    }

    #[test]
    fn parses_amount_with_zero_fraction_into_minor_units() {
        let req = request("bob", "alice", "250.00", "ref-1");
        assert_eq!(req.amount_minor_units(), Ok(250));
    }

    #[test]
    fn rejects_minor_units_for_invalid_amount() {
        let req = request("bob", "alice", "0", "ref-1");
        assert_eq!(
            req.amount_minor_units(),
            Err(TransferRequestError::NonPositiveAmount)
        );
    }
}
