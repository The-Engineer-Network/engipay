-- Admin accounts, sessions, and audit log (#488).
--
-- Admin accounts are completely separate from user accounts: different table,
-- different JWT signing key, mandatory TOTP second factor, and a closed set of
-- roles. They are NOT in the users table and carry no ledger balance.
--
-- Role permission matrix (enforced in application code; documented here for
-- reference):
--
--   support    – read-only user lookup, freeze / unfreeze accounts
--   compliance – everything support can do + approve / reject withdrawals,
--                update KYC tier, read the withdrawal queue
--   finance    – everything compliance can do + release a held withdrawal,
--                read the audit log
--
-- A support operator can NEVER release a withdrawal; that requires finance.

-- ── admin_accounts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    -- bcrypt hash of the password (never stored in plaintext).
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('support', 'compliance', 'finance')),
    -- Base32-encoded TOTP secret (RFC 6238, SHA-1, 30-second window).
    totp_secret     TEXT NOT NULL,
    -- Soft-delete: set to FALSE to lock out the account without losing history.
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_accounts_email
    ON admin_accounts (email);

COMMENT ON TABLE  admin_accounts              IS 'Operator accounts. Separate from user accounts; carry no ledger balance.';
COMMENT ON COLUMN admin_accounts.password_hash IS 'bcrypt hash. Never store plaintext.';
COMMENT ON COLUMN admin_accounts.totp_secret   IS 'Base32 TOTP secret (RFC 6238). Never expose in API responses.';

-- ── admin_sessions ────────────────────────────────────────────────────────────
--
-- Tracks the two-step login:
--   step_1  – password verified, TOTP not yet confirmed
--   active  – both factors confirmed; full admin JWT issued
--   revoked – explicitly logged out or invalidated

CREATE TABLE IF NOT EXISTS admin_sessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id                UUID NOT NULL REFERENCES admin_accounts (id),
    -- Corresponds to the `jti` claim in the issued JWT.
    jti                     TEXT NOT NULL UNIQUE,
    -- 'step_1' until TOTP is verified; 'active' once fully authenticated.
    state                   TEXT NOT NULL DEFAULT 'step_1'
                                CHECK (state IN ('step_1', 'active', 'revoked')),
    second_factor_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address              TEXT,
    user_agent              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Automatically expires sessions that are never used.
    expires_at              TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '15 minutes',
    CONSTRAINT admin_sessions_state_matches_factor
        CHECK (
            (state = 'step_1' AND second_factor_verified = FALSE)
            OR (state IN ('active', 'revoked'))
        )
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin
    ON admin_sessions (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_jti
    ON admin_sessions (jti);

COMMENT ON TABLE  admin_sessions                     IS 'Two-step login tracking for admin accounts.';
COMMENT ON COLUMN admin_sessions.second_factor_verified IS 'TRUE once TOTP is confirmed; FALSE during step-1.';

-- ── admin_audit_log ───────────────────────────────────────────────────────────
--
-- Every write action performed by an admin is recorded here.  Read-only
-- lookups are also recorded so there is a complete paper trail of who looked
-- at what.  Rows are append-only; the application trigger below prevents
-- UPDATE / DELETE.

CREATE TABLE IF NOT EXISTS admin_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    -- NULL only if the account was deleted after the fact (historical).
    actor_id    UUID REFERENCES admin_accounts (id),
    actor_email TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('support', 'compliance', 'finance')),
    action      TEXT NOT NULL,          -- e.g. 'freeze_user', 'approve_withdrawal'
    target_kind TEXT,                   -- e.g. 'user', 'withdrawal'
    target_id   TEXT,                   -- UUID or other identifier
    -- Arbitrary structured detail; never contains passwords or secrets.
    detail      JSONB,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_actor
    ON admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
    ON admin_audit_log (target_kind, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
    ON admin_audit_log (created_at DESC);

COMMENT ON TABLE admin_audit_log IS 'Append-only record of every admin action. Rows may never be updated or deleted.';

-- Append-only audit log enforcement.
CREATE FUNCTION admin_audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'admin_audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

CREATE TRIGGER admin_audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON admin_audit_log
    FOR EACH ROW EXECUTE FUNCTION admin_audit_log_append_only();

-- ── user_profiles: add frozen flag ───────────────────────────────────────────
--
-- Support / compliance admins can freeze a user's account.  A frozen account
-- cannot initiate transfers, withdrawals, or buy orders.  The ledger itself is
-- unaffected: the funds are still there, just not movable.

ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.frozen_at IS 'Set when the account is frozen by an admin. NULL means the account is active.';
