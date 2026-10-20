use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::limits;

/// Reserved system handles a user may never claim as their own tag.
const RESERVED_TAGS: [&str; 5] = ["admin", "engipay", "support", "system", "help"];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("tag must be 3 to 20 characters long, using only letters, numbers, or underscores")]
    InvalidFormat,
    #[error("\"{0}\" is a reserved handle and cannot be used as a tag")]
    ReservedTag(String),
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/me", get(get_me).patch(patch_me))
}

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PatchMeRequest {
    pub tag: String,
}

/// The signed-in user's profile. `tag` is stored without the leading `@`.
/// `daily_limit` is the 24-hour outgoing volume ceiling for their tier, as a
/// human amount such as "500 USDC".
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct MeResponse {
    pub tag: Option<String>,
    pub tier: i32,
    pub daily_limit: String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// GET /v1/me - the caller's tag, KYC tier and daily limit.
async fn get_me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<MeResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let (tag, tier): (Option<String>, i32) =
        sqlx::query_as("SELECT tag, tier FROM user_profiles WHERE id = $1")
            .bind(user_id.as_uuid())
            .fetch_optional(pool)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to load profile: {}", e)))?
            .ok_or(ApiError::NotFound)?;

    let limit = limits::tier_daily_limit(tier, state.config.tier_0_daily_limit_minor);
    Ok(Json(MeResponse {
        tag,
        tier,
        daily_limit: limit.to_string(),
    }))
}

/// PATCH /v1/me - set the caller's tag. Returns 409 if another user holds it.
async fn patch_me(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<PatchMeRequest>,
) -> Result<StatusCode, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let tag = req.tag.strip_prefix('@').unwrap_or(&req.tag);
    validate_tag(tag).map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let result = sqlx::query("UPDATE user_profiles SET tag = $2, updated_at = now() WHERE id = $1")
        .bind(user_id.as_uuid())
        .bind(tag)
        .execute(pool)
        .await;

    match result {
        Ok(done) if done.rows_affected() == 0 => Err(ApiError::NotFound),
        Ok(_) => Ok(StatusCode::NO_CONTENT),
        Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
            Err(ApiError::Conflict(format!("@{tag} is already taken")))
        }
        Err(e) => Err(ApiError::Internal(anyhow::anyhow!(
            "failed to save tag: {}",
            e
        ))),
    }
}

/// Validates a user-supplied tag against the naming rules: 3-20 alphanumeric
/// characters or underscores, and not one of the reserved system handles.
/// A leading `@`, if the user included one, is stripped before validation.
pub fn validate_tag(tag: &str) -> Result<(), ValidationError> {
    let tag = tag.strip_prefix('@').unwrap_or(tag);

    let len = tag.chars().count();
    let format_ok =
        (3..=20).contains(&len) && tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !format_ok {
        return Err(ValidationError::InvalidFormat);
    }

    if RESERVED_TAGS
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(tag))
    {
        return Err(ValidationError::ReservedTag(tag.to_string()));
    }

    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_valid_tag() {
        assert!(validate_tag("alice_92").is_ok());
    }

    #[test]
    fn strips_a_leading_at_sign_before_validating() {
        assert!(validate_tag("@alice_92").is_ok());
    }

    #[test]
    fn rejects_a_tag_shorter_than_three_characters() {
        assert_eq!(validate_tag("ab"), Err(ValidationError::InvalidFormat));
    }

    #[test]
    fn rejects_a_tag_longer_than_twenty_characters() {
        assert_eq!(
            validate_tag("a".repeat(21).as_str()),
            Err(ValidationError::InvalidFormat)
        );
    }

    #[test]
    fn rejects_special_characters() {
        assert_eq!(
            validate_tag("alice-92"),
            Err(ValidationError::InvalidFormat)
        );
        assert_eq!(
            validate_tag("alice 92"),
            Err(ValidationError::InvalidFormat)
        );
        assert_eq!(
            validate_tag("alice@92"),
            Err(ValidationError::InvalidFormat)
        );
    }

    #[test]
    fn rejects_reserved_handles_case_insensitively() {
        assert_eq!(
            validate_tag("admin"),
            Err(ValidationError::ReservedTag("admin".to_string()))
        );
        assert_eq!(
            validate_tag("Support"),
            Err(ValidationError::ReservedTag("Support".to_string()))
        );
        assert_eq!(
            validate_tag("@System"),
            Err(ValidationError::ReservedTag("System".to_string()))
        );
    }
}
