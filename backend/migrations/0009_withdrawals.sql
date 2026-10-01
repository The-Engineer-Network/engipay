-- Migration 0009: withdrawals table.
--
-- A withdrawal moves funds from a user's EngiPay balance to an on-chain
-- address. This table drives the broadcast worker in engipay-chain: the worker
-- polls for rows with status = 'pending_broadcast', claims them with
-- SELECT … FOR UPDATE SKIP LOCKED so concurrent workers never double-spend,
-- and advances the status through the lifecycle below.
--
-- Status lifecycle:
--   pending_broadcast  → broadcasting          (worker claims the row)
--   broadcasting       → broadcast_accepted    (the network accepted the transaction)
--   broadcasting       → failed                (the network rejected it outright)
--   broadcasting       → pending_broadcast     (failed before anything was submitted)
--   broadcasting       → pending_manual_review (submission outcome unknown)
--   broadcast_accepted → confirmed             (landed in a closed ledger)
--   broadcast_accepted → pending_manual_review (finality timeout)
--   pending_broadcast  → cooling_off           (destination first seen < 24 h ago)
--   cooling_off        → pending_broadcast     (cooling-off period has elapsed)
--
-- A row left in 'broadcasting' by a crash is never retried automatically: a
-- transaction may already be on-chain, and signing a second would pay twice.

CREATE TABLE IF NOT EXISTS withdrawals (
    id                     UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID           NOT NULL REFERENCES users (id),
    chain                  TEXT           NOT NULL CHECK (chain IN ('stellar', 'base', 'bitcoin')),
    asset                  TEXT           NOT NULL CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC')),
    -- Amount in the asset's smallest unit (same precision as the ledger).
    amount                 NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    -- Estimated network fee in the asset's smallest unit, agreed at creation
    -- time. The actual fee may differ once the broadcast worker prices it.
    estimated_network_fee  NUMERIC(78, 0) NOT NULL CHECK (estimated_network_fee >= 0),
    destination            TEXT           NOT NULL,
    -- Optional on-chain memo (text or numeric string). The broadcast worker
    -- converts numeric strings to ID memos; all others become text memos.
    memo                   TEXT,
    status                 TEXT           NOT NULL DEFAULT 'pending_broadcast'
                               CHECK (status IN (
                                   'pending_broadcast',
                                   'cooling_off',
                                   'broadcasting',
                                   'broadcast_accepted',
                                   'confirmed',
                                   'failed',
                                   'pending_manual_review'
                               )),
    -- Populated once Horizon accepts the signed XDR.
    tx_hash                TEXT           UNIQUE,
    -- The ledger sequence in which the transaction was confirmed.
    confirmed_ledger       BIGINT,
    -- When the cooling-off period expires (NULL when not in cooling_off).
    cooling_off_until      TIMESTAMPTZ,
    -- Human-readable reason for a rejected / failed broadcast (for support).
    failure_reason         TEXT,
    created_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT withdrawals_cooling_off_has_deadline
        CHECK (status <> 'cooling_off' OR cooling_off_until IS NOT NULL)
);

-- The broadcast worker index: only rows waiting to be processed.
CREATE INDEX IF NOT EXISTS idx_withdrawals_pending
    ON withdrawals (created_at ASC)
    WHERE status = 'pending_broadcast';

-- Cooling-off index: fast lookup of expired rows.
CREATE INDEX IF NOT EXISTS idx_withdrawals_cooling_off
    ON withdrawals (cooling_off_until ASC)
    WHERE status = 'cooling_off';

-- Per-user history, newest first.
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created
    ON withdrawals (user_id, created_at DESC);

COMMENT ON TABLE  withdrawals IS 'One row per user withdrawal request. Drives the broadcast worker in engipay-chain.';
COMMENT ON COLUMN withdrawals.status IS 'Lifecycle stage; see migration comment for transitions.';
COMMENT ON COLUMN withdrawals.memo   IS 'Optional on-chain memo. Numeric strings become ID memos; others become text memos.';
