//! KYC provider trait and fake implementation.
//!
//! ## Tier definitions
//!
//! | Tier | Description | Daily limit |
//! |------|-------------|-------------|
//! | 0    | Account created, no identity verification | 500 USDC |
//! | 1    | Name + government ID verified by provider | 1000 USDC |
//! | 2    | Name + ID + proof of address verified | 1500 USDC |
//!
//! A tier can only increase — a verified result from a higher tier than the
//! user's current tier causes the tier to be raised. A failed or pending result
//! changes nothing.
//!
//! No identity document numbers or image data are written to this module, to
//! logs, or to the audit trail. The audit trail records only whether a session
//! was verified and what tier was reached.

use serde::{Deserialize, Serialize};

/// The outcome of a KYC verification session from the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationOutcome {
    /// Identity verified. The `tier` field says which tier was reached.
    Verified { tier: i32 },
    /// Verification failed (document rejected, mismatch, etc.).
    Failed,
    /// Session created and waiting for the user to complete it in the
    /// provider's hosted flow.
    Pending,
}

/// A started verification session.
#[derive(Debug, Clone)]
pub struct SessionStarted {
    /// Opaque provider reference for this session (logged for support tickets).
    pub provider_ref: String,
    /// URL the client should redirect the user to, to complete the flow.
    pub redirect_url: String,
    /// The outcome to poll or webhook for (not returned to the client directly).
    pub outcome: VerificationOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum KycError {
    #[error("KYC provider is unavailable")]
    ProviderUnavailable,
    #[error("KYC provider error: {0}")]
    Provider(String),
}

/// An external (or simulated) KYC provider.
///
/// Implementations must not log or return identity document numbers, image
/// data, or any PII beyond what is needed to reference the session.
pub trait KycProvider: Send + Sync {
    /// Start a verification session for `user_id`. Returns a URL to redirect
    /// the user to and a provider reference for the audit trail.
    ///
    /// # Security
    ///
    /// Implementors must not include any identity document numbers or PII in
    /// the returned `provider_ref` string.  The reference is logged for
    /// support purposes; it must be opaque.
    fn start_session(&self, user_id: uuid::Uuid) -> Result<SessionStarted, KycError>;
}

// ── Fake implementation ───────────────────────────────────────────────────────

/// Always returns a session that immediately reports "verified at tier 1".
/// Used in tests and in development when no real KYC partner is connected.
pub struct FakeKycProvider;

impl KycProvider for FakeKycProvider {
    fn start_session(&self, user_id: uuid::Uuid) -> Result<SessionStarted, KycError> {
        Ok(SessionStarted {
            provider_ref: format!("fake-kyc-{user_id}"),
            redirect_url: format!("https://kyc.example.test/session/{user_id}"),
            outcome: VerificationOutcome::Verified { tier: 1 },
        })
    }
}

/// A fake KYC provider that always returns a failed outcome.
/// Useful for testing that a failed result does not change the tier.
pub struct FakeKycProviderFails;

impl KycProvider for FakeKycProviderFails {
    fn start_session(&self, user_id: uuid::Uuid) -> Result<SessionStarted, KycError> {
        Ok(SessionStarted {
            provider_ref: format!("fake-kyc-fail-{user_id}"),
            redirect_url: format!("https://kyc.example.test/session/fail/{user_id}"),
            outcome: VerificationOutcome::Failed,
        })
    }
}

/// Returns how many KYC tiers exist and what each one means.
/// Used to validate that a provider-supplied tier is within range.
pub const MAX_TIER: i32 = 2;

/// `true` when `tier` is a valid tier number the system recognises.
pub fn is_valid_tier(tier: i32) -> bool {
    (0..=MAX_TIER).contains(&tier)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn fake_provider_starts_a_session_verified_at_tier_1() {
        let prov = FakeKycProvider;
        let uid = Uuid::new_v4();
        let session = prov.start_session(uid).unwrap();
        assert!(matches!(
            session.outcome,
            VerificationOutcome::Verified { tier: 1 }
        ));
        // provider_ref must not contain identity document info.
        // The fake just includes the UUID which is fine (no PII).
        assert!(!session.provider_ref.is_empty());
    }

    #[test]
    fn fake_failing_provider_returns_failed() {
        let prov = FakeKycProviderFails;
        let uid = Uuid::new_v4();
        let session = prov.start_session(uid).unwrap();
        assert_eq!(session.outcome, VerificationOutcome::Failed);
    }

    #[test]
    fn valid_tier_range() {
        assert!(is_valid_tier(0));
        assert!(is_valid_tier(1));
        assert!(is_valid_tier(2));
        assert!(!is_valid_tier(-1));
        assert!(!is_valid_tier(3));
    }
}
