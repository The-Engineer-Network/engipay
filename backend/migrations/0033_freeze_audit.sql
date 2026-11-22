-- 0033_freeze_audit.sql
-- Audit log for account freeze and unfreeze actions (#726)
--
-- Records who froze or unfroze which account, when, and why.
-- Append-only: no updates or deletes allowed.

BEGIN;

CREATE TABLE freeze_audit (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users (id),
    action          TEXT NOT NULL CHECK (action IN ('freeze', 'unfreeze')),
    reason          TEXT,
    actor           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for efficient lookups by user and time
CREATE INDEX idx_freeze_audit_user_id ON freeze_audit (user_id, created_at DESC);
CREATE INDEX idx_freeze_audit_created_at ON freeze_audit (created_at DESC);

-- Append-only: prevent updates and deletes
CREATE RULE freeze_audit_no_update AS ON UPDATE TO freeze_audit DO INSTEAD NOTHING;
CREATE RULE freeze_audit_no_delete AS ON DELETE TO freeze_audit DO INSTEAD NOTHING;

COMMENT ON TABLE freeze_audit IS 'Append-only audit log for account freeze/unfreeze actions';
COMMENT ON COLUMN freeze_audit.user_id IS 'The user whose account was frozen or unfrozen';
COMMENT ON COLUMN freeze_audit.action IS 'Either freeze or unfreeze';
COMMENT ON COLUMN freeze_audit.reason IS 'Human-readable reason for the action';
COMMENT ON COLUMN freeze_audit.actor IS 'Identifier of the person who performed the action (e.g. admin username or operator ID)';

COMMIT;
