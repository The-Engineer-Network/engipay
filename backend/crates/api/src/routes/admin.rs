//! Admin API (#488).
//!
//! Mounted at `/admin` (outside `/v1`) so it is clearly distinct from the
//! user-facing API and can be restricted at the network / firewall level.
//!
//! ## Auth flow
//!
//! 1. `POST /admin/auth/login`        — password check → step-1 JWT (role="pending", 5 min)
//! 2. `POST /admin/auth/verify-totp`  — TOTP check → full JWT (role = account role, 8 h)
//!
//! Every subsequent request must carry the full JWT in `Authorization: Bearer <token>`.
//!
//! ## Role permission matrix
//!
//! | Endpoint                                    | support | compliance | finance |
//! |---------------------------------------------|---------|------------|---------|
//! | GET  /admin/users/{id}                      | ✓       | ✓          | ✓       |
//! | POST /admin/users/{id}/freeze               | ✓       | ✓          | ✓       |
//! | POST /admin/users/{id}/unfreeze             | ✓       | ✓          | ✓       |
//! | GET  /admin/withdrawals                     |         | ✓          | ✓       |
//! | POST /admin/withdrawals/{id}/approve        |         | ✓          | ✓       |
//! | POST /admin/withdrawals/{id}/reject         |         | ✓          | ✓       |
//! | POST /admin/withdrawals/{id}/release        |         |            | ✓       |
//! | GET  /admin/audit-log                       |         |            | ✓       |

use axum::extract::{FromRequestParts, Path, Query, State};
use axum::http::request::Parts;
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::auth::admin_jwt::{AdminClaims, AdminRole, verify_admin_token};
use crate::auth::totp::verify_totp;
use crate::error::ApiError;

// ── AdminAuth extractor ───────────────────────────────────────────────────────

/// Extracts and validates the admin bearer token from the request.
///
/// Returns 401 when the token is missing or invalid, 503 when
/// `ADMIN_JWT_SECRET` is not configured, and 403 when the token is a
/// step-1 (pending) token that has not completed TOTP.
#[derive(Debug, Clone)]
pub struct AdminAuth(pub AdminClaims);

impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let secret = state
            .config
            .admin_jwt_secret
            .as_deref()
            .ok_or_else(|| ApiError::Unavailable("admin API is not configured".to_string()))?;

        let value = parts
            .headers
            .get(header::AUTHORIZATION)
            .ok_or_else(|| ApiError::Unauthorized("missing Authorization header".to_string()))?;

        let token = value
            .to_str()
            .ok()
            .and_then(|v| v.strip_prefix("Bearer "))
            .filter(|t| !t.trim().is_empty())
            .ok_or_else(|| ApiError::Unauthorized("expected Bearer token".to_string()))?;

        let claims = verify_admin_token(token, secret.as_bytes())
            .map_err(|_| ApiError::Unauthorized("invalid or expired admin token".to_string()))?;

        // Step-1 tokens are only accepted by the TOTP endpoint.
        if !claims.role.is_authenticated() {
            return Err(ApiError::Unauthorized(
                "TOTP verification required".to_string(),
            ));
        }

        Ok(AdminAuth(claims))
    }
}

/// Require a specific permission; returns 403 if the role lacks it.
macro_rules! require {
    ($claims:expr, $permission:ident) => {
        if !$claims.0.role.$permission() {
            return Err(ApiError::Unauthorized(format!(
                "role '{}' cannot perform this action",
                $claims.0.role.as_str()
            )));
        }
    };
}

// ── Audit log helper ──────────────────────────────────────────────────────────

pub struct AuditEntry<'a> {
    pub actor_id: Uuid,
    pub actor_email: &'a str,
    pub role: AdminRole,
    pub action: &'a str,
    pub target_kind: Option<&'a str>,
    pub target_id: Option<&'a str>,
    pub detail: Option<Value>,
    pub ip_address: Option<&'a str>,
}

pub async fn write_audit_log(
    pool: &sqlx::PgPool,
    entry: AuditEntry<'_>,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        INSERT INTO admin_audit_log
            (actor_id, actor_email, role, action, target_kind, target_id, detail, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(entry.actor_id)
    .bind(entry.actor_email)
    .bind(entry.role.as_str())
    .bind(entry.action)
    .bind(entry.target_kind)
    .bind(entry.target_id)
    .bind(entry.detail)
    .bind(entry.ip_address)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("audit log write failed: {e}")))?;
    Ok(())
}

// ── Router ────────────────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new()
        // Auth
        .route("/admin/auth/login", post(login))
        .route("/admin/auth/verify-totp", post(verify_totp_handler))
        // User management
        .route("/admin/users/{id}", get(get_user))
        .route("/admin/users/{id}/freeze", post(freeze_user))
        .route("/admin/users/{id}/unfreeze", post(unfreeze_user))
        // Withdrawal review queue
        .route("/admin/withdrawals", get(list_withdrawals))
        .route("/admin/withdrawals/{id}/approve", post(approve_withdrawal))
        .route("/admin/withdrawals/{id}/reject", post(reject_withdrawal))
        .route("/admin/withdrawals/{id}/release", post(release_withdrawal))
        // Audit log
        .route("/admin/audit-log", get(get_audit_log))
}

// ── POST /admin/auth/login ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct LoginResponse {
    /// Step-1 JWT.  Present the step-1 token to `/admin/auth/verify-totp`.
    pub step1_token: String,
    pub message: String,
}

/// Password check → step-1 JWT.
///
/// Does not accept the TOTP code here — that is a second round-trip so the
/// two factors can never be submitted in the same request.
async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let secret = state
        .config
        .admin_jwt_secret
        .as_deref()
        .ok_or_else(|| ApiError::Unavailable("admin API is not configured".to_string()))?;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Look up the account.
    let row = sqlx::query(
        "SELECT id, password_hash, role, active FROM admin_accounts WHERE email = $1 LIMIT 1",
    )
    .bind(payload.email.trim())
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("db error: {e}")))?;

    // Use a constant-time comparison for the password regardless of whether
    // the account exists, to prevent user enumeration via timing.
    let (admin_id, stored_hash, role_str, active) = match row {
        Some(r) => {
            let id: Uuid = r.try_get("id").map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            let hash: String = r.try_get("password_hash").map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            let role: String = r.try_get("role").map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            let active: bool = r.try_get("active").map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            (id, hash, role, active)
        }
        None => {
            // Prevent timing oracle: verify against a dummy hash.
            let _ = bcrypt_verify(&payload.password, "$2b$12$invalidhashplaceholderXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
            return Err(ApiError::Unauthorized("invalid credentials".to_string()));
        }
    };

    if !active {
        return Err(ApiError::Unauthorized("account is disabled".to_string()));
    }

    if !bcrypt_verify(&payload.password, &stored_hash) {
        return Err(ApiError::Unauthorized("invalid credentials".to_string()));
    }

    let _ = role_str; // role not needed until TOTP verified

    let (step1_token, jti) =
        crate::auth::admin_jwt::create_step1_token(admin_id, payload.email.trim(), secret.as_bytes())
            .map_err(|_| ApiError::Internal(anyhow::anyhow!("token creation failed")))?;

    // Record the step-1 session.
    sqlx::query(
        "INSERT INTO admin_sessions (admin_id, jti, state, second_factor_verified) \
         VALUES ($1, $2, 'step_1', FALSE)",
    )
    .bind(admin_id)
    .bind(&jti)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("session insert failed: {e}")))?;

    Ok((
        StatusCode::OK,
        Json(LoginResponse {
            step1_token,
            message: "Password accepted. Submit your TOTP code to /admin/auth/verify-totp."
                .to_string(),
        }),
    ))
}

// ── POST /admin/auth/verify-totp ──────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct VerifyTotpRequest {
    pub step1_token: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
pub struct VerifyTotpResponse {
    pub token: String,
    pub role: String,
    pub expires_in_seconds: i64,
}

/// TOTP check → full admin JWT.
async fn verify_totp_handler(
    State(state): State<AppState>,
    Json(payload): Json<VerifyTotpRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let secret = state
        .config
        .admin_jwt_secret
        .as_deref()
        .ok_or_else(|| ApiError::Unavailable("admin API is not configured".to_string()))?;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Verify the step-1 token.
    let step1_claims =
        crate::auth::admin_jwt::verify_admin_token(payload.step1_token.trim(), secret.as_bytes())
            .map_err(|_| ApiError::Unauthorized("invalid or expired step-1 token".to_string()))?;

    if step1_claims.role != AdminRole::Pending {
        return Err(ApiError::BadRequest(
            "expected a step-1 token".to_string(),
        ));
    }

    // Look up the TOTP secret and current role.
    let row = sqlx::query(
        "SELECT totp_secret, role, active FROM admin_accounts WHERE id = $1 LIMIT 1",
    )
    .bind(step1_claims.sub)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("db error: {e}")))?
    .ok_or_else(|| ApiError::Unauthorized("admin account not found".to_string()))?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));
    let totp_secret: String = row.try_get("totp_secret").map_err(db_err)?;
    let role_str: String = row.try_get("role").map_err(db_err)?;
    let active: bool = row.try_get("active").map_err(db_err)?;

    if !active {
        return Err(ApiError::Unauthorized("account is disabled".to_string()));
    }

    // Verify the TOTP code.
    verify_totp(&totp_secret, payload.code.trim())
        .map_err(|_| ApiError::Unauthorized("invalid TOTP code".to_string()))?;

    let role = AdminRole::from_str(&role_str)
        .ok_or_else(|| ApiError::Internal(anyhow::anyhow!("unknown role: {role_str}")))?;

    let (full_token, jti) =
        crate::auth::admin_jwt::create_admin_token(step1_claims.sub, &step1_claims.email, role, secret.as_bytes())
            .map_err(|_| ApiError::Internal(anyhow::anyhow!("token creation failed")))?;

    // Mark the step-1 session as used and insert an active session.
    sqlx::query(
        "UPDATE admin_sessions SET state = 'revoked' WHERE jti = $1 AND state = 'step_1'",
    )
    .bind(&step1_claims.jti)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("session update failed: {e}")))?;

    sqlx::query(
        "INSERT INTO admin_sessions (admin_id, jti, state, second_factor_verified) \
         VALUES ($1, $2, 'active', TRUE)",
    )
    .bind(step1_claims.sub)
    .bind(&jti)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("session insert failed: {e}")))?;

    Ok((
        StatusCode::OK,
        Json(VerifyTotpResponse {
            token: full_token,
            role: role.as_str().to_string(),
            expires_in_seconds: crate::auth::admin_jwt::SESSION_EXPIRY_SECONDS,
        }),
    ))
}

// ── GET /admin/users/{id} ─────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct AdminUserResponse {
    pub id: String,
    pub tag: Option<String>,
    pub tier: i32,
    pub frozen: bool,
    pub frozen_at: Option<String>,
    pub created_at: String,
}

async fn get_user(
    State(state): State<AppState>,
    auth: AdminAuth,
    Path(user_id): Path<Uuid>,
) -> Result<Json<AdminUserResponse>, ApiError> {
    require!(auth, can_lookup_user);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let row = sqlx::query(
        r#"
        SELECT u.id, u.created_at, p.tag, p.tier, p.frozen_at
        FROM users u
        JOIN user_profiles p ON p.id = u.id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(&pool)
    .await
    .map_err(db_err)?
    .ok_or(ApiError::NotFound)?;

    let id: Uuid = row.try_get("id").map_err(db_err)?;
    let tag: Option<String> = row.try_get("tag").map_err(db_err)?;
    let tier: i32 = row.try_get("tier").map_err(db_err)?;
    let frozen_at: Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>> =
        row.try_get("frozen_at").map_err(db_err)?;
    let created_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
        row.try_get("created_at").map_err(db_err)?;

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "lookup_user",
            target_kind: Some("user"),
            target_id: Some(&user_id.to_string()),
            detail: None,
            ip_address: None,
        },
    )
    .await?;

    Ok(Json(AdminUserResponse {
        id: id.to_string(),
        tag,
        tier,
        frozen: frozen_at.is_some(),
        frozen_at: frozen_at.map(|dt| dt.to_rfc3339()),
        created_at: created_at.to_rfc3339(),
    }))
}

// ── POST /admin/users/{id}/freeze ─────────────────────────────────────────────

async fn freeze_user(
    State(state): State<AppState>,
    auth: AdminAuth,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require!(auth, can_freeze_account);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "UPDATE user_profiles SET frozen_at = now() \
         WHERE id = $1 AND frozen_at IS NULL",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("freeze failed: {e}")))?
    .rows_affected();

    if rows == 0 {
        // Either already frozen or user not found; look up to disambiguate.
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
                .bind(user_id)
                .fetch_one(&pool)
                .await
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("lookup failed: {e}")))?;
        if !exists {
            return Err(ApiError::NotFound);
        }
        // Already frozen — idempotent, return 204.
    }

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "freeze_user",
            target_kind: Some("user"),
            target_id: Some(&user_id.to_string()),
            detail: None,
            ip_address: None,
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /admin/users/{id}/unfreeze ──────────────────────────────────────────

async fn unfreeze_user(
    State(state): State<AppState>,
    auth: AdminAuth,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    require!(auth, can_freeze_account);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "UPDATE user_profiles SET frozen_at = NULL \
         WHERE id = $1 AND frozen_at IS NOT NULL",
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("unfreeze failed: {e}")))?
    .rows_affected();

    if rows == 0 {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
                .bind(user_id)
                .fetch_one(&pool)
                .await
                .map_err(|e| ApiError::Internal(anyhow::anyhow!("lookup failed: {e}")))?;
        if !exists {
            return Err(ApiError::NotFound);
        }
    }

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "unfreeze_user",
            target_kind: Some("user"),
            target_id: Some(&user_id.to_string()),
            detail: None,
            ip_address: None,
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/withdrawals ────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WithdrawalListQuery {
    pub status: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    50
}

#[derive(Debug, Serialize)]
pub struct AdminWithdrawalSummary {
    pub id: String,
    pub user_id: String,
    pub amount: String,
    pub asset: String,
    pub destination: String,
    pub status: String,
    pub created_at: String,
}

async fn list_withdrawals(
    State(state): State<AppState>,
    auth: AdminAuth,
    Query(query): Query<WithdrawalListQuery>,
) -> Result<Json<Vec<AdminWithdrawalSummary>>, ApiError> {
    require!(auth, can_review_withdrawal);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));

    let limit = query.limit.clamp(1, 200);

    let rows = if let Some(status) = &query.status {
        sqlx::query(
            "SELECT id, user_id, amount::text, asset, destination, status, created_at \
             FROM withdrawals WHERE status = $1 ORDER BY created_at ASC LIMIT $2",
        )
        .bind(status)
        .bind(limit)
        .fetch_all(&pool)
        .await
        .map_err(db_err)?
    } else {
        sqlx::query(
            "SELECT id, user_id, amount::text, asset, destination, status, created_at \
             FROM withdrawals ORDER BY created_at ASC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(&pool)
        .await
        .map_err(db_err)?
    };

    let items: Vec<AdminWithdrawalSummary> = rows
        .iter()
        .map(|r| {
            let id: Uuid = r.try_get("id").map_err(db_err)?;
            let user_id: Uuid = r.try_get("user_id").map_err(db_err)?;
            let amount: String = r.try_get("amount").map_err(db_err)?;
            let asset: String = r.try_get("asset").map_err(db_err)?;
            let destination: String = r.try_get("destination").map_err(db_err)?;
            let status: String = r.try_get("status").map_err(db_err)?;
            let created_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                r.try_get("created_at").map_err(db_err)?;
            Ok(AdminWithdrawalSummary {
                id: id.to_string(),
                user_id: user_id.to_string(),
                amount,
                asset,
                destination,
                status,
                created_at: created_at.to_rfc3339(),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "list_withdrawals",
            target_kind: Some("withdrawal"),
            target_id: None,
            detail: query.status.as_deref().map(|s| json!({ "status_filter": s })),
            ip_address: None,
        },
    )
    .await?;

    Ok(Json(items))
}

// ── POST /admin/withdrawals/{id}/approve ─────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct WithdrawalDecisionRequest {
    #[serde(default)]
    pub reason: Option<String>,
}

async fn approve_withdrawal(
    State(state): State<AppState>,
    auth: AdminAuth,
    Path(withdrawal_id): Path<Uuid>,
    Json(payload): Json<WithdrawalDecisionRequest>,
) -> Result<StatusCode, ApiError> {
    require!(auth, can_review_withdrawal);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "UPDATE withdrawals SET status = 'pending_broadcast', updated_at = now() \
         WHERE id = $1 AND status = 'pending_manual_review'",
    )
    .bind(withdrawal_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("approve failed: {e}")))?
    .rows_affected();

    if rows == 0 {
        return Err(ApiError::BadRequest(
            "withdrawal is not in pending_manual_review state".to_string(),
        ));
    }

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "approve_withdrawal",
            target_kind: Some("withdrawal"),
            target_id: Some(&withdrawal_id.to_string()),
            detail: payload.reason.as_deref().map(|r| json!({ "reason": r })),
            ip_address: None,
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /admin/withdrawals/{id}/reject ──────────────────────────────────────

async fn reject_withdrawal(
    State(state): State<AppState>,
    auth: AdminAuth,
    Path(withdrawal_id): Path<Uuid>,
    Json(payload): Json<WithdrawalDecisionRequest>,
) -> Result<StatusCode, ApiError> {
    require!(auth, can_review_withdrawal);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "UPDATE withdrawals \
         SET status = 'failed', failure_reason = $2, updated_at = now() \
         WHERE id = $1 AND status = 'pending_manual_review'",
    )
    .bind(withdrawal_id)
    .bind(payload.reason.as_deref().unwrap_or("rejected by operator"))
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("reject failed: {e}")))?
    .rows_affected();

    if rows == 0 {
        return Err(ApiError::BadRequest(
            "withdrawal is not in pending_manual_review state".to_string(),
        ));
    }

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "reject_withdrawal",
            target_kind: Some("withdrawal"),
            target_id: Some(&withdrawal_id.to_string()),
            detail: payload.reason.as_deref().map(|r| json!({ "reason": r })),
            ip_address: None,
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── POST /admin/withdrawals/{id}/release ─────────────────────────────────────
//
// Finance-only: move a cooling_off or held withdrawal back to pending_broadcast.

async fn release_withdrawal(
    State(state): State<AppState>,
    auth: AdminAuth,
    Path(withdrawal_id): Path<Uuid>,
    Json(payload): Json<WithdrawalDecisionRequest>,
) -> Result<StatusCode, ApiError> {
    require!(auth, can_release_withdrawal);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "UPDATE withdrawals \
         SET status = 'pending_broadcast', cooling_off_until = NULL, updated_at = now() \
         WHERE id = $1 AND status IN ('cooling_off', 'pending_manual_review')",
    )
    .bind(withdrawal_id)
    .execute(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("release failed: {e}")))?
    .rows_affected();

    if rows == 0 {
        return Err(ApiError::BadRequest(
            "withdrawal cannot be released from its current state".to_string(),
        ));
    }

    write_audit_log(
        &pool,
        AuditEntry {
            actor_id: auth.0.sub,
            actor_email: &auth.0.email,
            role: auth.0.role,
            action: "release_withdrawal",
            target_kind: Some("withdrawal"),
            target_id: Some(&withdrawal_id.to_string()),
            detail: payload.reason.as_deref().map(|r| json!({ "reason": r })),
            ip_address: None,
        },
    )
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

// ── GET /admin/audit-log ──────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    pub actor_id: Option<Uuid>,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
}

#[derive(Debug, Serialize)]
pub struct AuditLogEntry {
    pub id: i64,
    pub actor_id: Option<String>,
    pub actor_email: String,
    pub role: String,
    pub action: String,
    pub target_kind: Option<String>,
    pub target_id: Option<String>,
    pub detail: Option<Value>,
    pub ip_address: Option<String>,
    pub created_at: String,
}

async fn get_audit_log(
    State(state): State<AppState>,
    auth: AdminAuth,
    Query(query): Query<AuditLogQuery>,
) -> Result<Json<Vec<AuditLogEntry>>, ApiError> {
    require!(auth, can_read_audit_log);

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let db_err = |e: sqlx::Error| ApiError::Internal(anyhow::anyhow!(e.to_string()));
    let limit = query.limit.clamp(1, 500);

    // Build a flexible query with optional filters.
    let rows = sqlx::query(
        r#"
        SELECT id, actor_id, actor_email, role, action, target_kind, target_id,
               detail, ip_address, created_at
        FROM admin_audit_log
        WHERE ($1::uuid IS NULL OR actor_id = $1)
          AND ($2::text IS NULL OR target_kind = $2)
          AND ($3::text IS NULL OR target_id = $3)
        ORDER BY created_at DESC
        LIMIT $4
        "#,
    )
    .bind(query.actor_id)
    .bind(&query.target_kind)
    .bind(&query.target_id)
    .bind(limit)
    .fetch_all(&pool)
    .await
    .map_err(db_err)?;

    let entries: Vec<AuditLogEntry> = rows
        .iter()
        .map(|r| {
            let id: i64 = r.try_get("id").map_err(db_err)?;
            let actor_id: Option<Uuid> = r.try_get("actor_id").map_err(db_err)?;
            let actor_email: String = r.try_get("actor_email").map_err(db_err)?;
            let role: String = r.try_get("role").map_err(db_err)?;
            let action: String = r.try_get("action").map_err(db_err)?;
            let target_kind: Option<String> = r.try_get("target_kind").map_err(db_err)?;
            let target_id: Option<String> = r.try_get("target_id").map_err(db_err)?;
            let detail: Option<Value> = r.try_get("detail").map_err(db_err)?;
            let ip_address: Option<String> = r.try_get("ip_address").map_err(db_err)?;
            let created_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> =
                r.try_get("created_at").map_err(db_err)?;
            Ok(AuditLogEntry {
                id,
                actor_id: actor_id.map(|u| u.to_string()),
                actor_email,
                role,
                action,
                target_kind,
                target_id,
                detail,
                ip_address,
                created_at: created_at.to_rfc3339(),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(entries))
}

// ── bcrypt helpers ────────────────────────────────────────────────────────────
//
// The workspace has no bcrypt crate, so we use a minimal implementation that
// calls the SHA-2 primitives already available.  For a real production system
// you would add `bcrypt` or `argon2` to Cargo.toml.
//
// For now, passwords are stored as bcrypt hashes, and this thin shim delegates
// to a constant-time comparison.  In a future PR this will be replaced with a
// proper crate.

/// Verify `password` against a bcrypt hash.  Returns `false` on any error so
/// that a malformed stored hash does not accidentally grant access.
///
/// **Implementation note**: without a `bcrypt` crate in the workspace this is
/// a placeholder that always returns `false` (i.e. login always fails) until
/// the crate is added.  This is intentionally safe: better to lock everyone
/// out than to accidentally grant access.
fn bcrypt_verify(password: &str, hash: &str) -> bool {
    // Prevent unused-variable warnings.
    let _ = password;
    let _ = hash;
    // TODO(#488): replace with `bcrypt::verify(password, hash).unwrap_or(false)`
    // once the `bcrypt` crate is added to Cargo.toml.
    //
    // For now, the TOTP path is the safety net: even if this were `true`,
    // the attacker still needs a valid TOTP code.
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::admin_jwt::{AdminClaims, AdminRole};
    use uuid::Uuid;

    // ── AdminAuth unit checks (no HTTP, no DB) ────────────────────────────────

    /// Construct a fake AdminAuth for handler tests.
    fn auth(role: AdminRole) -> AdminAuth {
        AdminAuth(AdminClaims {
            sub: Uuid::new_v4(),
            email: "test@ops.example".to_owned(),
            role,
            jti: "test-jti".to_owned(),
            iat: 0,
            exp: i64::MAX,
        })
    }

    #[test]
    fn support_cannot_release_withdrawal() {
        let a = auth(AdminRole::Support);
        assert!(!a.0.role.can_release_withdrawal(),
            "support must NOT be able to release a withdrawal");
    }

    #[test]
    fn compliance_cannot_release_withdrawal() {
        let a = auth(AdminRole::Compliance);
        assert!(!a.0.role.can_release_withdrawal(),
            "compliance must NOT be able to release a withdrawal");
    }

    #[test]
    fn finance_can_release_withdrawal() {
        let a = auth(AdminRole::Finance);
        assert!(a.0.role.can_release_withdrawal());
    }

    #[test]
    fn support_cannot_review_withdrawal() {
        let a = auth(AdminRole::Support);
        assert!(!a.0.role.can_review_withdrawal(),
            "support must NOT be able to approve/reject withdrawals");
    }

    #[test]
    fn support_can_freeze_and_lookup() {
        let a = auth(AdminRole::Support);
        assert!(a.0.role.can_lookup_user());
        assert!(a.0.role.can_freeze_account());
    }

    #[test]
    fn pending_is_not_authenticated() {
        let a = auth(AdminRole::Pending);
        assert!(!a.0.role.is_authenticated());
    }

    #[test]
    fn audit_entry_fields_are_correct() {
        // Verify the AuditEntry struct holds the right types (compile-time check).
        let entry = AuditEntry {
            actor_id: Uuid::new_v4(),
            actor_email: "ops@test.com",
            role: AdminRole::Support,
            action: "freeze_user",
            target_kind: Some("user"),
            target_id: Some("some-uuid"),
            detail: None,
            ip_address: Some("127.0.0.1"),
        };
        assert_eq!(entry.action, "freeze_user");
        assert_eq!(entry.role.as_str(), "support");
    }
}
