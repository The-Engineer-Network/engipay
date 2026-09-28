use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use engipay_core::UserId;

use crate::auth::jwt::{self, Claims};
use crate::{error::ApiError, AppState};

/// Authenticated bearer token extracted from the request header.
///
/// Token verification remains the responsibility of the authentication
/// service; this extractor only enforces the transport contract shared by
/// protected handlers. Call [`AuthUser::verify`] to check the signature and
/// get the caller's [`UserId`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthUser {
    pub token: String,
}

impl AuthUser {
    /// Verifies the bearer token's signature and expiry and returns its claims.
    pub fn verify(&self, jwt_secret: &[u8]) -> Result<Claims, ApiError> {
        jwt::verify_token(&self.token, jwt_secret)
            .map_err(|_| ApiError::Unauthorized("invalid or expired token".to_string()))
    }

    /// Verifies the token and returns the caller's [`UserId`] — the common
    /// case for a handler that just needs to know who is calling.
    pub fn user_id(&self, jwt_secret: &[u8]) -> Result<UserId, ApiError> {
        self.verify(jwt_secret).map(|claims| UserId::from_uuid(claims.sub))
    }
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