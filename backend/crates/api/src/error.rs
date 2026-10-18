use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// Every error the API returns has the same shape:
/// `{ "error": { "code": "insufficient_funds", "message": "..." } }`.
/// The code is stable for the frontend to branch on; the message is for people.
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("the database is not available")]
    DatabaseUnavailable,
    /// A dependency the API needs is not configured or is currently down.
    /// The message is deliberately generic: it must never echo configuration
    /// variable names or upstream error details back to the caller.
    #[error("service unavailable")]
    ServiceUnavailable(String),
    #[error("{0}")]
    LimitExceeded(String),
    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

/// Ledger-level failures surfaced by the withdrawal flow. Kept separate from
/// [`ApiError`] so the domain can express money-specific failures (e.g. an
/// available balance that does not cover the principal plus the network fee)
/// without leaking HTTP concerns into the ledger layer.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LedgerError {
    /// The user's available balance does not cover the withdrawal principal
    /// plus the estimated network fee. Amounts are in the smallest indivisible
    /// unit (no floating point) and detail required vs available funds.
    #[error(
        "insufficient funds: required {required} (amount {amount} + network fee {network_fee}), available {available}"
    )]
    InsufficientFunds {
        required: i64,
        available: i64,
        amount: i64,
        network_fee: i64,
    },
    /// The supplied amount or fee is not a positive integer.
    #[error("amount must be a positive integer")]
    InvalidAmount,
    /// The withdrawal destination is one of EngiPay's own custody addresses.
    /// Sending funds to a custody address would loop money on-chain and incur
    /// unnecessary network fees without crediting any user.
    #[error("destination address is an EngiPay custody account and cannot be used for withdrawals")]
    InvalidDestination,
}

impl ApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            ApiError::DatabaseUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "database_unavailable")
            }
            ApiError::ServiceUnavailable(_) => {
                (StatusCode::SERVICE_UNAVAILABLE, "service_unavailable")
            }
            ApiError::LimitExceeded(_) => (StatusCode::FORBIDDEN, "limit_exceeded"),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl From<LedgerError> for ApiError {
    fn from(error: LedgerError) -> Self {
        match error {
            LedgerError::InsufficientFunds { .. } => ApiError::BadRequest(error.to_string()),
            LedgerError::InvalidAmount => ApiError::BadRequest(error.to_string()),
            LedgerError::InvalidDestination => ApiError::BadRequest(error.to_string()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        // Internal details go to the logs, never to the client.
        if let ApiError::Internal(error) = &self {
            tracing::error!(error = ?error, "internal error");
        }
        // The detail on a service-unavailable error may name configuration
        // variables or upstream failures; log it and send a generic message.
        let message = match &self {
            ApiError::ServiceUnavailable(detail) => {
                tracing::error!(detail = %detail, "service unavailable");
                "service unavailable".to_owned()
            }
            other => other.to_string(),
        };
        let body = Json(json!({ "error": { "code": code, "message": message } }));
        (status, body).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insufficient_funds_reports_required_and_available() {
        let error = LedgerError::InsufficientFunds {
            required: 10_500,
            available: 10_000,
            amount: 10_000,
            network_fee: 500,
        };

        let message = error.to_string();
        assert!(message.contains("required 10500"));
        assert!(message.contains("available 10000"));
        assert!(message.contains("amount 10000"));
        assert!(message.contains("network fee 500"));
    }

    #[test]
    fn insufficient_funds_maps_to_bad_request() {
        let error = LedgerError::InsufficientFunds {
            required: 10_500,
            available: 10_000,
            amount: 10_000,
            network_fee: 500,
        };

        let api_error: ApiError = error.into();
        let (status, code) = api_error.status_and_code();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(code, "bad_request");
    }

    #[test]
    fn invalid_amount_maps_to_bad_request() {
        let api_error: ApiError = LedgerError::InvalidAmount.into();
        let (status, code) = api_error.status_and_code();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(code, "bad_request");
    }

    #[test]
    fn invalid_destination_maps_to_bad_request() {
        let api_error: ApiError = LedgerError::InvalidDestination.into();
        let (status, code) = api_error.status_and_code();
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(code, "bad_request");
    }

    #[test]
    fn invalid_destination_message_mentions_custody() {
        let message = LedgerError::InvalidDestination.to_string();
        assert!(
            message.contains("custody"),
            "error message should mention custody account: {message}"
        );
    }

    #[test]
    fn service_unavailable_maps_to_503() {
        let api_error = ApiError::ServiceUnavailable("chain service down".to_owned());
        let (status, code) = api_error.status_and_code();
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(code, "service_unavailable");
    }

    #[tokio::test]
    async fn service_unavailable_hides_detail_from_client() {
        let api_error =
            ApiError::ServiceUnavailable("STELLAR_CUSTODY_ADDRESS is not set".to_owned());
        let response = api_error.into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body should be readable");
        let body = String::from_utf8(body.to_vec()).expect("body should be utf-8");
        assert!(
            !body.contains("STELLAR_CUSTODY_ADDRESS"),
            "response must not echo configuration variable names: {body}"
        );
        assert!(
            body.contains("service unavailable"),
            "response should carry a generic message: {body}"
        );
    }
}
