-- Add XLM (Stellar Lumens) asset support to ledger_postings check constraint.
--
-- XLM is a native currency supported in EngiPay's multi-chain architecture
-- for the Stellar network. This migration safely drops and recreates the asset
-- check constraint to include 'XLM' while maintaining backward compatibility
-- and preserving the append-only properties of the ledger.

-- Drop the existing check constraint on ledger_postings.asset
ALTER TABLE ledger_postings DROP CONSTRAINT ledger_postings_asset_check;

-- Drop the existing check constraint on ledger_holds.asset
ALTER TABLE ledger_holds DROP CONSTRAINT ledger_holds_asset_check;

-- Recreate the constraint on ledger_postings with XLM added
ALTER TABLE ledger_postings
    ADD CONSTRAINT ledger_postings_asset_check CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM'));

-- Recreate the constraint on ledger_holds with XLM added
ALTER TABLE ledger_holds
    ADD CONSTRAINT ledger_holds_asset_check CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM'));
