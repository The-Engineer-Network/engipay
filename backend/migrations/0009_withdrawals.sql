-- Migration 0009: withdrawals table.
--
-- Tracks every outbound payment: the user, the amount, the destination
-- address, the hold reference that locks the funds, and the Horizon
-- transaction hash once the payment has landed on-chain.
--
-- Status lifecycle (enforced by engipay_chain::withdrawals):
--
--   pending_broadcast → broadcast_accepted → confirmed → completed
--          │                    │               ▲
--          │                    ▼               │
--          ├──────────► pending_manual_review ──┘   (outcome unknown: timeout,
--          │                    │                    Horizon unreachable)
--          ▼                    ▼
--        failed ◄───────────────┘                   (rejected or failed on-chain;
--                                                    the hold is released)
--
-- The hold_reference column ties each withdrawal to a row in ledger_holds.
-- Settlement settles (or releases) that hold before marking the withdrawal
-- completed (or failed); both ledger operations are idempotent, so a crash
-- between the two steps is repaired by running settlement again.

CREATE TABLE withdrawals (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES users (id),
    asset               TEXT        NOT NULL CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM')),
    -- Amount in the asset's smallest unit (same precision as the ledger).
    amount              NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    -- The fee locked alongside the principal in the hold; booked to the
    -- Fees system account when the withdrawal settles.
    estimated_fee       NUMERIC(78, 0) NOT NULL CHECK (estimated_fee >= 0),
    -- The on-chain destination address.
    destination         TEXT        NOT NULL,
    -- The ledger reference for the hold that locks principal + fee.
    hold_reference      TEXT        NOT NULL REFERENCES ledger_holds (reference),
    -- The Horizon transaction hash, populated after broadcast_accepted.
    tx_hash             TEXT        UNIQUE,
    -- The ledger sequence in which the transaction was confirmed, populated
    -- after confirmation.
    confirmed_ledger    BIGINT,
    status              TEXT        NOT NULL DEFAULT 'pending_broadcast'
                            CHECK (status IN (
                                'pending_broadcast',
                                'broadcast_accepted',
                                'confirmed',
                                'completed',
                                'pending_manual_review',
                                'failed'
                            )),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_withdrawals_user_created ON withdrawals (user_id, created_at DESC);
CREATE INDEX idx_withdrawals_hold_reference ON withdrawals (hold_reference);
CREATE INDEX idx_withdrawals_tx_hash ON withdrawals (tx_hash) WHERE tx_hash IS NOT NULL;

COMMENT ON TABLE  withdrawals                  IS 'One row per outbound payment request.';
COMMENT ON COLUMN withdrawals.hold_reference   IS 'Ledger hold that locked principal + fee.';
COMMENT ON COLUMN withdrawals.tx_hash          IS 'Horizon transaction hash; populated after broadcast_accepted.';
COMMENT ON COLUMN withdrawals.confirmed_ledger IS 'Stellar ledger sequence in which the tx was confirmed; populated after confirmed.';
