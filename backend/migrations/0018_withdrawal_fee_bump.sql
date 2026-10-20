-- Migration 0018: extra network fee booked by fee bumps (issue #517).
--
-- When a broadcast transaction sits out of ledgers during surge pricing the
-- chain service wraps it in a fee-bump transaction. The surcharge is charged
-- to the withdrawal's own hold, so it is recorded here and added to
-- estimated_network_fee when the hold settles: every stroop that leaves as a
-- network fee lands in the ledger's Fees account.

ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS extra_network_fee NUMERIC(78, 0) NOT NULL DEFAULT 0;

ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_extra_network_fee_non_negative;
ALTER TABLE withdrawals
    ADD CONSTRAINT withdrawals_extra_network_fee_non_negative
    CHECK (extra_network_fee >= 0);

COMMENT ON COLUMN withdrawals.extra_network_fee IS
    'Extra network fee paid by fee bumps on top of estimated_network_fee, in the asset smallest unit. Booked to the Fees account when the hold settles.';
