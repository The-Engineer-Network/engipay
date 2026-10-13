-- Migration 0013: what the settlement worker needs on `withdrawals`.
--
-- The chain service settles a withdrawal against the ledger hold that locked
-- the money when it was requested, and marks the row `completed` once the
-- hold is settled. Migration 0011 had neither the hold reference nor that
-- final status, so the settlement path could not read or finish a row.

-- The ledger hold that backs this withdrawal. Nullable: rows created before
-- this migration have none, and the settlement worker refuses those rather
-- than guessing which hold to settle.
ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS hold_reference TEXT;

-- One withdrawal per hold: settling a hold twice would pay out twice.
CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_hold_reference_key
    ON withdrawals (hold_reference)
    WHERE hold_reference IS NOT NULL;

-- `completed`: confirmed on-chain and the ledger hold is settled.
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE withdrawals ADD CONSTRAINT withdrawals_status_check
    CHECK (status IN (
        'pending_broadcast',
        'cooling_off',
        'broadcasting',
        'broadcast_accepted',
        'confirmed',
        'completed',
        'failed',
        'pending_manual_review'
    ));
