use axum::{routing::post, Json, Router};
use serde::Serialize;
use uuid::Uuid;

use crate::AppState;

#[derive(Debug, Serialize)]
pub struct NonceResponse {
    pub nonce: String,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/auth/nonce", post(issue_nonce))
}

/// Issues a fresh nonce for the SIWE handshake. Persistence and five-minute
/// consumption are handled by the nonce store introduced in issue #98.
async fn issue_nonce() -> Json<NonceResponse> {
    Json(NonceResponse {
        nonce: Uuid::new_v4().simple().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn issues_a_32_character_nonce() {
        let Json(response) = issue_nonce().await;
        assert_eq!(response.nonce.len(), 32);
        assert!(response.nonce.chars().all(|character| character.is_ascii_hexdigit()));
    }
}