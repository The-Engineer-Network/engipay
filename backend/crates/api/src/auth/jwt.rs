//! Session JWTs.
//!
//! Issued once a wallet has proven ownership (SIWE for EVM, SEP-10 for
//! Stellar) and verified on every authenticated request after that. The
//! signature is HMAC-SHA256 over the standard claims below; there is no
//! "none" algorithm and no algorithm negotiation, so a forged token cannot
//! talk its way past verification.

use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The default lifetime of a session token.
pub const DEFAULT_EXPIRY_SECONDS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Claims {
    /// The authenticated user's id.
    pub sub: Uuid,
    /// The wallet address that proved ownership at login.
    pub wallet: String,
    /// Issued-at, Unix seconds.
    pub iat: i64,
    /// Expiry, Unix seconds.
    pub exp: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum AuthError {
    #[error("failed to create token")]
    TokenCreation,
    #[error("token has expired")]
    ExpiredToken,
    #[error("invalid token")]
    InvalidToken,
}

/// Issues a session token for `user_id`/`wallet`, valid for
/// [`DEFAULT_EXPIRY_SECONDS`] from now.
pub fn create_token(user_id: Uuid, wallet: String, secret: &[u8]) -> Result<String, AuthError> {
    let now = current_timestamp();

    let claims = Claims {
        sub: user_id,
        wallet,
        iat: now,
        exp: now.saturating_add(DEFAULT_EXPIRY_SECONDS),
    };

    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|_| AuthError::TokenCreation)
}

/// Decodes `token`, checking the HMAC-SHA256 signature and that it has not
/// expired. `jsonwebtoken` enforces `exp` itself (with no leeway beyond
/// clock skew), so an expired signature-valid token is reported distinctly
/// from a malformed or signature-invalid one.
pub fn verify_token(token: &str, secret: &[u8]) -> Result<Claims, AuthError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "sub"]);
    // jsonwebtoken allows 60 seconds of clock leeway by default, which would
    // keep accepting a session after it expired. Sessions here end exactly
    // when they say they do.
    validation.leeway = 0;

    let data =
        decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation).map_err(|err| {
            match err.kind() {
                jsonwebtoken::errors::ErrorKind::ExpiredSignature => AuthError::ExpiredToken,
                _ => AuthError::InvalidToken,
            }
        })?;

    Ok(data.claims)
}

fn current_timestamp() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_secs() as i64
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    fn secret() -> &'static [u8] {
        b"test-secret-do-not-use-in-production"
    }

    #[test]
    fn creates_a_token_with_expected_claims() {
        let user_id = Uuid::new_v4();
        let wallet = "GABCDEF...".to_string();

        let token = create_token(user_id, wallet.clone(), secret()).unwrap();
        let claims = verify_token(&token, secret()).unwrap();

        assert_eq!(claims.sub, user_id);
        assert_eq!(claims.wallet, wallet);
    }

    #[test]
    fn expiry_defaults_to_24_hours_from_issued_at() {
        let token = create_token(Uuid::new_v4(), "wallet".to_string(), secret()).unwrap();
        let claims = verify_token(&token, secret()).unwrap();

        assert_eq!(claims.exp - claims.iat, DEFAULT_EXPIRY_SECONDS);
    }

    #[test]
    fn round_trips_through_verify_token() {
        let user_id = Uuid::new_v4();
        let token = create_token(user_id, "wallet".to_string(), secret()).unwrap();

        let claims = verify_token(&token, secret()).unwrap();
        assert_eq!(claims.sub, user_id);
    }

    #[test]
    fn rejects_a_token_signed_with_a_different_secret() {
        let token = create_token(Uuid::new_v4(), "wallet".to_string(), secret()).unwrap();

        let result = verify_token(&token, b"a-completely-different-secret");
        assert!(matches!(result, Err(AuthError::InvalidToken)));
    }

    #[test]
    fn rejects_an_expired_token() {
        let claims = Claims {
            sub: Uuid::new_v4(),
            wallet: "wallet".to_string(),
            iat: current_timestamp() - 2 * DEFAULT_EXPIRY_SECONDS,
            exp: current_timestamp() - 1,
        };

        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret()),
        )
        .unwrap();

        let result = verify_token(&token, secret());
        assert!(matches!(result, Err(AuthError::ExpiredToken)));
    }

    #[test]
    fn rejects_a_malformed_token_string() {
        let result = verify_token("not-a-jwt", secret());
        assert!(matches!(result, Err(AuthError::InvalidToken)));

        let result = verify_token("", secret());
        assert!(matches!(result, Err(AuthError::InvalidToken)));

        let result = verify_token("a.b.c.d", secret());
        assert!(matches!(result, Err(AuthError::InvalidToken)));
    }
}
