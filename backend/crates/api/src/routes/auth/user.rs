use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use crate::{error::ApiError, AppState};

/// Authenticated bearer token extracted from the request header.
///
/// Token verification remains the responsibility of the authentication
/// service; this extractor only enforces the transport contract shared by
/// protected handlers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthUser {
    pub token: String,
}

#[axum::async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let value = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .ok_or_else(|| ApiError::Unauthorized("missing Authorization header".to_string()))?;
        let value = value
            .to_str()
            .map_err(|_| ApiError::Unauthorized("invalid Authorization header".to_string()))?;
        let token = value
            .strip_prefix("Bearer ")
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| ApiError::Unauthorized("expected Bearer token".to_string()))?;

        Ok(Self {
            token: token.to_string(),
        })
    }
}