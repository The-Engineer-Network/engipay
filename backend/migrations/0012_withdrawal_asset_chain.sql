-- Ensure withdrawals store the asset and chain for each withdrawal.
-- Existing deployments may already have these columns from 0011; use
-- ADD COLUMN IF NOT EXISTS so this migration is safe to apply on top of them.

ALTER TABLE withdrawals
    ADD COLUMN IF NOT EXISTS asset TEXT NOT NULL DEFAULT 'USDC',
    ADD COLUMN IF NOT EXISTS chain TEXT NOT NULL DEFAULT 'base';

-- Drop any pre-existing constraints with the same names so the migration is
-- idempotent, then re-add the canonical CHECK constraints.
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_asset_check;
ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_chain_check;

ALTER TABLE withdrawals
    ADD CONSTRAINT withdrawals_asset_check
        CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC')),
    ADD CONSTRAINT withdrawals_chain_check
        CHECK (chain IN ('stellar', 'base', 'bitcoin'));