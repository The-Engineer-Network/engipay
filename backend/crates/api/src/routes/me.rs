use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::limits;
use crate::services::recipients::{RecipientRisk, assess_recipient};

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
    Router::new()
        .route("/me", get(get_me).patch(patch_me))
        .route("/contacts", get(list_contacts).post(create_contact))
        .route(
            "/contacts/{id}",
            patch(update_contact).delete(delete_contact),
        )
        .route("/recipients/risk", get(recipient_risk))
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

#[derive(Debug, Deserialize)]
pub struct CreateContactRequest {
    pub label: String,
    pub identifier: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateContactRequest {
    pub label: Option<String>,
    pub identifier: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct ContactResponse {
    pub id: String,
    pub label: String,
    pub identifier: String,
}

#[derive(Debug, Deserialize)]
pub struct RecipientRiskQuery {
    pub identifier: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RecipientRiskResponse {
    pub first_time: bool,
    pub look_alike: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_contact_id: Option<String>,
}

impl From<RecipientRisk> for RecipientRiskResponse {
    fn from(risk: RecipientRisk) -> Self {
        Self {
            first_time: risk.first_time,
            look_alike: risk.look_alike,
            matched_contact_id: risk.matched_contact_id,
        }
    }
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

/// GET /v1/contacts - list the caller's saved contacts.
async fn list_contacts(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<ContactResponse>>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows: Vec<(uuid::Uuid, String, String)> = sqlx::query_as(
        "SELECT id, label, identifier FROM contacts WHERE user_id = $1 ORDER BY label ASC",
    )
    .bind(user_id.as_uuid())
    .fetch_all(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to list contacts: {}", e)))?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, label, identifier)| ContactResponse {
                id: id.to_string(),
                label,
                identifier,
            })
            .collect(),
    ))
}

/// POST /v1/contacts - save a new contact for the caller.
async fn create_contact(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateContactRequest>,
) -> Result<(StatusCode, Json<ContactResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let label = req.label.trim();
    let identifier = req.identifier.trim();
    if label.is_empty() || identifier.is_empty() {
        return Err(ApiError::BadRequest(
            "label and identifier must not be empty".to_string(),
        ));
    }

    let (id, label, identifier): (uuid::Uuid, String, String) = sqlx::query_as(
        "INSERT INTO contacts (user_id, label, identifier) VALUES ($1, $2, $3) \
         RETURNING id, label, identifier",
    )
    .bind(user_id.as_uuid())
    .bind(label)
    .bind(identifier)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to create contact: {}", e)))?;

    Ok((
        StatusCode::CREATED,
        Json(ContactResponse {
            id: id.to_string(),
            label,
            identifier,
        }),
    ))
}

/// PATCH /v1/contacts/{id} - update a contact owned by the caller.
async fn update_contact(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<uuid::Uuid>,
    Json(req): Json<UpdateContactRequest>,
) -> Result<Json<ContactResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let label = req.label.as_deref().map(str::trim);
    let identifier = req.identifier.as_deref().map(str::trim);
    if matches!(label, Some("")) || matches!(identifier, Some("")) {
        return Err(ApiError::BadRequest(
            "label and identifier must not be empty".to_string(),
        ));
    }

    let row: Option<(uuid::Uuid, String, String)> = sqlx::query_as(
        "UPDATE contacts SET label = COALESCE($3, label), \
         identifier = COALESCE($4, identifier), updated_at = now() \
         WHERE id = $1 AND user_id = $2 RETURNING id, label, identifier",
    )
    .bind(id)
    .bind(user_id.as_uuid())
    .bind(label)
    .bind(identifier)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to update contact: {}", e)))?;

    let (id, label, identifier) = row.ok_or(ApiError::NotFound)?;
    Ok(Json(ContactResponse {
        id: id.to_string(),
        label,
        identifier,
    }))
}

/// DELETE /v1/contacts/{id} - remove a contact owned by the caller.
async fn delete_contact(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<uuid::Uuid>,
) -> Result<StatusCode, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let done = sqlx::query("DELETE FROM contacts WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id.as_uuid())
        .execute(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to delete contact: {}", e)))?;

    if done.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// GET /v1/recipients/risk - flag first-time and look-alike recipients.
async fn recipient_risk(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<RecipientRiskQuery>,
) -> Result<Json<RecipientRiskResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let identifier = query.identifier.trim();
    if identifier.is_empty() {
        return Err(ApiError::BadRequest(
            "identifier must not be empty".to_string(),
        ));
    }

    let risk = assess_recipient(pool, user_id.as_uuid(), identifier)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to assess recipient: {}", e)))?;

    Ok(Json(risk.into()))
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
