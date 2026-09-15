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
    #[error("not found")]
    NotFound,
    #[error("the database is not available")]
    DatabaseUnavailable,
    #[error("internal error")]
    Internal(#[from] anyhow::Error),
}

impl ApiError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::DatabaseUnavailable => {
                (StatusCode::SERVICE_UNAVAILABLE, "database_unavailable")
            }
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
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
        let body = Json(json!({ "error": { "code": code, "message": self.to_string() } }));
        (status, body).into_response()
    }
}
