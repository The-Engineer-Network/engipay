-- Migration 0008: Dead-Letter Queue for deposits that could not be credited.
--
-- When the DepositCreditor worker encounters a deposit it cannot apply to the
-- ledger (unknown recipient, database error, malformed payload, etc.) it
-- writes a row here so operations can investigate and reprocess it manually.
--
-- The status lifecycle is:
--   pending_investigation → resolved   (operator confirms root cause, fixed)
--   pending_investigation → reprocessed (deposit credited after a code fix)
--
-- No FK to ledger_transactions: a row here by definition means no ledger
-- transaction was created.

CREATE TABLE IF NOT EXISTS uncredited_deposits (
    id          BIGSERIAL    PRIMARY KEY,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Machine-readable failure code, e.g. 'unknown_recipient',
    -- 'database_constraint', 'malformed_payload', or 'other:<detail>'.
    reason      TEXT         NOT NULL CHECK (length(btrim(reason)) > 0),
    -- Full JSON-serialised ObservedDeposit for forensics and reprocessing.
    raw_payload JSONB        NOT NULL,
    -- Workflow status; operators change this once the issue is resolved.
    status      TEXT         NOT NULL DEFAULT 'pending_investigation'
                             CHECK (status IN ('pending_investigation', 'resolved', 'reprocessed'))
);

COMMENT ON TABLE uncredited_deposits IS
    'Dead-letter queue for on-chain deposits that the creditor worker could not apply to the ledger.';
COMMENT ON COLUMN uncredited_deposits.reason IS
    'Stable failure code written by DepositCreditor: unknown_recipient | database_constraint | malformed_payload | other:<detail>.';
COMMENT ON COLUMN uncredited_deposits.raw_payload IS
    'Full JSON snapshot of the ObservedDeposit for forensic analysis. Amount is stored as amount_minor (integer) to preserve exactness.';
COMMENT ON COLUMN uncredited_deposits.status IS
    'Operator workflow state: pending_investigation → resolved or reprocessed.';

CREATE INDEX IF NOT EXISTS idx_uncredited_deposits_status_created
    ON uncredited_deposits (status, created_at DESC);
