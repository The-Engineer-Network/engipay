-- KYC audit trail: records every verification outcome without storing any
-- identity document numbers, image data, or other PII.
--
-- The provider_ref is an opaque reference from the KYC partner, used for
-- support tickets. It must not contain document numbers or biometric data.
-- The tier_before and tier_after columns document exactly when and why a
-- user's tier changed, satisfying audit requirements without PII.

CREATE TABLE IF NOT EXISTS kyc_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id),
    provider_ref    TEXT NOT NULL,
    outcome         TEXT NOT NULL CHECK (outcome IN ('verified', 'failed', 'pending')),
    tier_before     INTEGER NOT NULL,
    tier_after      INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_sessions_user
    ON kyc_sessions (user_id, created_at DESC);

COMMENT ON TABLE  kyc_sessions             IS 'Audit trail for KYC verification outcomes. No PII stored here.';
COMMENT ON COLUMN kyc_sessions.provider_ref IS 'Opaque reference from the KYC provider. Must not contain document numbers.';
COMMENT ON COLUMN kyc_sessions.outcome      IS 'Verification result: verified, failed, or pending.';
COMMENT ON COLUMN kyc_sessions.tier_before  IS 'User tier before this session.';
COMMENT ON COLUMN kyc_sessions.tier_after   IS 'User tier after this session (same as tier_before on failed/pending).';
