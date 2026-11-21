//! KYC verification session endpoint.
//!
//! ## POST /v1/kyc/session
//! Starts a KYC verification session with the configured provider.
//! The provider's redirect URL is returned so the client can open the
//! hosted identity flow.
//!
//! On a `verified` outcome the tier is raised — never lowered — and the
//! outcome is written to `kyc_sessions` as an audit trail. A `failed` or
//! `pending` outcome leaves the tier unchanged but is still audited.
//!
//! ## GET /v1/kyc/session
//! Returns the caller's latest KYC session: its outcome, the tier it
//! grants, and when it was created. Returns 404 when the caller has no
//! session yet.
//!
//! ## Security
//! - No identity document numbers, images, or biometric data are written to
//!   the audit trail or to logs.
//! - The `provider_ref` is an opaque reference from the provider; its contract
//!   (see [`crate::services::kyc_provider::KycProvider`]) prohibits PII.
//!
//! ## Tier definitions
//! | Tier | Meaning           | Daily limit (default) |
//! |------|-------------------|-----------------------|
//! | 0    | No verification   | 500 USDC              |
//! | 1    | ID verified       | 1 000 USDC            |
//! | 2    | ID + address      | 1 500 USDC            |

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::kyc_provider::{KycError, VerificationOutcome, is_valid_tier};

pub fn routes() -> Router<AppState> {
    Router::new().route(
        "/kyc/session",
        get(get_latest_session).post(create_session),
    )
}

// ── Response types ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SessionResponse {
    /// Opaque provider reference. Not a document number; safe to log.
    pub provider_ref: String,
    /// URL for the client to redirect to for the identity flow.
    pub redirect_url: String,
    /// The user's tier after this call.
    pub tier: i32,
    /// "verified", "failed", or "pending".
    pub outcome: String,
}

#[derive(Debug, Serialize)]
pub struct LatestSessionResponse {
    /// Opaque provider reference. Not a document number; safe to log.
    pub provider_ref: String,
    /// "verified", "failed", or "pending".
    pub outcome: String,
    /// The tier this session grants (the tier after the session ran).
    pub tier: i32,
    /// The tier the user had before this session ran.
    pub tier_before: i32,
    /// When the session was recorded.
    pub created_at: DateTime<Utc>,
}

// ── Handler ───────────────────────────────────────────────────────────────────

async fn create_session(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<(StatusCode, Json<SessionResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Fetch the current tier.
    let tier_before: i32 = sqlx::query_scalar("SELECT tier FROM user_profiles WHERE id = $1")
        .bind(user_id.as_uuid())
        .fetch_optional(db)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to load profile: {e}")))?
        .ok_or(ApiError::NotFound)?;

    // Start a session with the provider.
    // SECURITY: provider_ref must not contain document numbers or PII.
    let session = state
        .kyc_provider
        .start_session(user_id.as_uuid())
        .map_err(|e| match e {
            KycError::ProviderUnavailable => {
                ApiError::Unavailable("KYC provider is currently unavailable.".to_string())
            }
            KycError::Provider(msg) => {
                ApiError::Internal(anyhow::anyhow!("KYC provider error: {msg}"))
            }
        })?;

    // Determine the new tier.
    let tier_after = match session.outcome {
        VerificationOutcome::Verified { tier } if is_valid_tier(tier) && tier > tier_before => tier,
        _ => tier_before,
    };

    let outcome_str = match session.outcome {
        VerificationOutcome::Verified { .. } => "verified",
        VerificationOutcome::Failed => "failed",
        VerificationOutcome::Pending => "pending",
    };

    // Raise the tier atomically if the outcome is verified to a higher level.
    if tier_after > tier_before {
        // Conditional update: only raises, never lowers, handles concurrency.
        sqlx::query(
            "UPDATE user_profiles SET tier = $2, updated_at = now() \
             WHERE id = $1 AND tier < $2",
        )
        .bind(user_id.as_uuid())
        .bind(tier_after)
        .execute(db)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to update tier: {e}")))?;
    }

    // Write audit record. No document numbers or PII — only the opaque ref,
    // the outcome, and the tier before/after.
    sqlx::query(
        "INSERT INTO kyc_sessions \
             (user_id, provider_ref, outcome, tier_before, tier_after) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user_id.as_uuid())
    .bind(&session.provider_ref)
    .bind(outcome_str)
    .bind(tier_before)
    .bind(tier_after)
    .execute(db)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to write KYC audit record: {e}")))?;

    // Log outcome without PII.
    tracing::info!(
        user_id = %user_id.as_uuid(),
        provider_ref = %session.provider_ref,
        outcome = %outcome_str,
        tier_before,
        tier_after,
        "KYC session completed"
    );

    Ok((
        StatusCode::CREATED,
        Json(SessionResponse {
            provider_ref: session.provider_ref,
            redirect_url: session.redirect_url,
            tier: tier_after,
            outcome: outcome_str.to_string(),
        }),
    ))
}

// ── Latest session handler ────────────────────────────────────────────────────

async fn get_latest_session(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<LatestSessionResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let row: Option<(String, String, i32, i32, DateTime<Utc>)> = sqlx::query_as(
        "SELECT provider_ref, outcome, tier_after, tier_before, created_at \
         FROM kyc_sessions \
         WHERE user_id = $1 \
         ORDER BY created_at DESC \
         LIMIT 1",
    )
    .bind(user_id.as_uuid())
    .fetch_optional(db)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to load KYC session: {e}")))?;

    let (provider_ref, outcome, tier, tier_before, created_at) = row.ok_or(ApiError::NotFound)?;

    Ok(Json(LatestSessionResponse {
        provider_ref,
        outcome,
        tier,
        tier_before,
        created_at,
    }))
}
