//! Admin session JWTs.
//!
//! Completely separate from the user JWT in `auth::jwt`:
//!   - Different signing key (`ADMIN_JWT_SECRET`).
//!   - Claims carry a `role` field and a `jti` for session revocation.
//!   - Two-step issuance: step-1 token has `role = "pending"` (password only),
//!     full token has the actual role after TOTP is confirmed.
//!
//! There is no "none" algorithm and no algorithm negotiation.

use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifetime of the step-1 (pre-TOTP) token: 5 minutes to complete the second factor.
pub const STEP1_EXPIRY_SECONDS: i64 = 5 * 60;
/// Lifetime of a fully-authenticated admin session: 8 hours.
pub const SESSION_EXPIRY_SECONDS: i64 = 8 * 60 * 60;

/// The set of roles an admin account may hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AdminRole {
    /// Password verified, TOTP not yet confirmed.  Only valid for the
    /// `/admin/auth/verify-totp` endpoint.
    Pending,
    /// Read-only user lookup, freeze / unfreeze accounts.
    Support,
    /// Everything `support` can do + approve / reject withdrawals, update KYC tier.
    Compliance,
    /// Everything `compliance` can do + release held withdrawals, read the audit log.
    Finance,
}

impl AdminRole {
    /// Human-readable string stored in the audit log and the JWT.
    pub const fn as_str(self) -> &'static str {
        match self {
            AdminRole::Pending => "pending",
            AdminRole::Support => "support",
            AdminRole::Compliance => "compliance",
            AdminRole::Finance => "finance",
        }
    }

    /// Parse from a database / wire string.
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(AdminRole::Pending),
            "support" => Some(AdminRole::Support),
            "compliance" => Some(AdminRole::Compliance),
            "finance" => Some(AdminRole::Finance),
            _ => None,
        }
    }

    /// Returns `true` if this role is fully authenticated (not step-1 pending).
    pub fn is_authenticated(self) -> bool {
        !matches!(self, AdminRole::Pending)
    }

    // ── Permission helpers ────────────────────────────────────────────────────

    /// Any authenticated admin can look up a user or read their own audit entries.
    pub fn can_lookup_user(self) -> bool {
        self.is_authenticated()
    }

    /// Support and above can freeze / unfreeze accounts.
    pub fn can_freeze_account(self) -> bool {
        matches!(self, AdminRole::Support | AdminRole::Compliance | AdminRole::Finance)
    }

    /// Compliance and above can approve or reject withdrawals.
    pub fn can_review_withdrawal(self) -> bool {
        matches!(self, AdminRole::Compliance | AdminRole::Finance)
    }

    /// Only finance may release a held withdrawal.
    pub fn can_release_withdrawal(self) -> bool {
        matches!(self, AdminRole::Finance)
    }

    /// Only finance may read the full audit log.
    pub fn can_read_audit_log(self) -> bool {
        matches!(self, AdminRole::Finance)
    }
}

/// Claims embedded in every admin JWT.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminClaims {
    /// Admin account id.
    pub sub: Uuid,
    /// Admin email (for quick identification in logs).
    pub email: String,
    /// Role, including `"pending"` for step-1 tokens.
    pub role: AdminRole,
    /// JWT ID, matching the `jti` column in `admin_sessions`.
    pub jti: String,
    /// Issued-at, Unix seconds.
    pub iat: i64,
    /// Expiry, Unix seconds.
    pub exp: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum AdminAuthError {
    #[error("failed to create admin token")]
    TokenCreation,
    #[error("admin token has expired")]
    ExpiredToken,
    #[error("invalid admin token")]
    InvalidToken,
    #[error("admin token is a step-1 token; TOTP verification required")]
    Step1Token,
    #[error("insufficient role: {0} cannot perform this action")]
    InsufficientRole(String),
}

/// Issue a step-1 admin token (password verified, TOTP not yet confirmed).
/// The `role` claim is `"pending"` so it is useless everywhere except
/// `POST /admin/auth/verify-totp`.
pub fn create_step1_token(
    admin_id: Uuid,
    email: &str,
    secret: &[u8],
) -> Result<(String, String), AdminAuthError> {
    let jti = Uuid::new_v4().to_string();
    let now = current_timestamp();
    let claims = AdminClaims {
        sub: admin_id,
        email: email.to_owned(),
        role: AdminRole::Pending,
        jti: jti.clone(),
        iat: now,
        exp: now.saturating_add(STEP1_EXPIRY_SECONDS),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|_| AdminAuthError::TokenCreation)?;
    Ok((token, jti))
}

/// Issue a fully-authenticated admin token (both factors confirmed).
pub fn create_admin_token(
    admin_id: Uuid,
    email: &str,
    role: AdminRole,
    secret: &[u8],
) -> Result<(String, String), AdminAuthError> {
    let jti = Uuid::new_v4().to_string();
    let now = current_timestamp();
    let claims = AdminClaims {
        sub: admin_id,
        email: email.to_owned(),
        role,
        jti: jti.clone(),
        iat: now,
        exp: now.saturating_add(SESSION_EXPIRY_SECONDS),
    };
    let token = encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(secret),
    )
    .map_err(|_| AdminAuthError::TokenCreation)?;
    Ok((token, jti))
}

/// Decode and verify an admin JWT.  Does not check the role; callers use
/// [`AdminClaims::role`] for that.
pub fn verify_admin_token(token: &str, secret: &[u8]) -> Result<AdminClaims, AdminAuthError> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.set_required_spec_claims(&["exp", "sub"]);
    validation.leeway = 0;

    let data = decode::<AdminClaims>(token, &DecodingKey::from_secret(secret), &validation)
        .map_err(|err| match err.kind() {
            jsonwebtoken::errors::ErrorKind::ExpiredSignature => AdminAuthError::ExpiredToken,
            _ => AdminAuthError::InvalidToken,
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
mod tests {
    use super::*;

    fn secret() -> &'static [u8] {
        b"admin-test-secret-do-not-use-in-production"
    }

    // ── AdminRole permission matrix ───────────────────────────────────────────

    #[test]
    fn support_can_lookup_and_freeze_but_not_review_or_release() {
        let r = AdminRole::Support;
        assert!(r.can_lookup_user());
        assert!(r.can_freeze_account());
        assert!(!r.can_review_withdrawal(), "support must NOT review withdrawals");
        assert!(!r.can_release_withdrawal(), "support must NOT release withdrawals");
        assert!(!r.can_read_audit_log(), "support must NOT read audit log");
    }

    #[test]
    fn compliance_can_review_but_not_release() {
        let r = AdminRole::Compliance;
        assert!(r.can_lookup_user());
        assert!(r.can_freeze_account());
        assert!(r.can_review_withdrawal());
        assert!(!r.can_release_withdrawal(), "compliance must NOT release withdrawals");
        assert!(!r.can_read_audit_log());
    }

    #[test]
    fn finance_has_all_permissions() {
        let r = AdminRole::Finance;
        assert!(r.can_lookup_user());
        assert!(r.can_freeze_account());
        assert!(r.can_review_withdrawal());
        assert!(r.can_release_withdrawal());
        assert!(r.can_read_audit_log());
    }

    #[test]
    fn pending_role_has_no_permissions() {
        let r = AdminRole::Pending;
        assert!(!r.is_authenticated());
        assert!(!r.can_lookup_user());
        assert!(!r.can_freeze_account());
        assert!(!r.can_review_withdrawal());
        assert!(!r.can_release_withdrawal());
        assert!(!r.can_read_audit_log());
    }

    // ── Token issuance and verification ──────────────────────────────────────

    #[test]
    fn step1_token_has_pending_role() {
        let id = Uuid::new_v4();
        let (token, jti) = create_step1_token(id, "ops@test", secret()).unwrap();
        let claims = verify_admin_token(&token, secret()).unwrap();
        assert_eq!(claims.sub, id);
        assert_eq!(claims.role, AdminRole::Pending);
        assert_eq!(claims.jti, jti);
    }

    #[test]
    fn full_token_carries_real_role() {
        let id = Uuid::new_v4();
        let (token, _) =
            create_admin_token(id, "ops@test", AdminRole::Compliance, secret()).unwrap();
        let claims = verify_admin_token(&token, secret()).unwrap();
        assert_eq!(claims.role, AdminRole::Compliance);
    }

    #[test]
    fn token_signed_with_different_secret_is_rejected() {
        let (token, _) =
            create_admin_token(Uuid::new_v4(), "ops@test", AdminRole::Support, secret()).unwrap();
        assert!(verify_admin_token(&token, b"wrong-secret").is_err());
    }

    #[test]
    fn expired_token_is_rejected() {
        let now = {
            use std::time::{SystemTime, UNIX_EPOCH};
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
        };
        let claims = AdminClaims {
            sub: Uuid::new_v4(),
            email: "test@test".to_owned(),
            role: AdminRole::Finance,
            jti: "test-jti".to_owned(),
            iat: now - 100,
            exp: now - 1,
        };
        let token = jsonwebtoken::encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret()),
        )
        .unwrap();
        assert!(matches!(
            verify_admin_token(&token, secret()),
            Err(AdminAuthError::ExpiredToken)
        ));
    }

    #[test]
    fn role_roundtrips_through_string() {
        for role in [
            AdminRole::Pending,
            AdminRole::Support,
            AdminRole::Compliance,
            AdminRole::Finance,
        ] {
            assert_eq!(AdminRole::from_str(role.as_str()), Some(role));
        }
    }
}
