-- Migration 0007: align deposit_addresses with the Epic 1 schema.
--
-- The original 0002 migration created deposit_addresses without a
-- UNIQUE(user_id, chain) constraint or a derivation_index column.  Migration
-- 0005 used CREATE TABLE IF NOT EXISTS so these additions were never applied
-- when upgrading an existing database.  This migration adds them idempotently.
--
-- The UNIQUE(chain, address) constraint from 0002 is dropped: on Base and
-- Bitcoin, all users currently share the custody address (until the chain
-- service exposes per-user key derivation), so the address is not globally
-- unique.  The UNIQUE(user_id, chain) constraint is the meaningful one:
-- one deposit address per user per chain.

-- Add derivation_index column for EVM/Bitcoin address derivation tracking.
ALTER TABLE deposit_addresses
    ADD COLUMN IF NOT EXISTS derivation_index INT;

-- Drop the old address-level uniqueness constraint (only applies to the 0002
-- schema; the 0005 schema never had it because its CREATE TABLE IF NOT EXISTS
-- was skipped).
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'deposit_addresses_chain_address_key'
          AND  conrelid = 'deposit_addresses'::regclass
    ) THEN
        ALTER TABLE deposit_addresses
            DROP CONSTRAINT deposit_addresses_chain_address_key;
    END IF;
END
$$;

-- Add UNIQUE(user_id, chain): one address per user per chain.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'deposit_addresses_user_id_chain_key'
          AND  conrelid = 'deposit_addresses'::regclass
    ) THEN
        ALTER TABLE deposit_addresses
            ADD CONSTRAINT deposit_addresses_user_id_chain_key UNIQUE (user_id, chain);
    END IF;
END
$$;

-- Add a CHECK on chain values if one does not already exist.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'deposit_addresses_chain_check'
          AND  conrelid = 'deposit_addresses'::regclass
    ) THEN
        ALTER TABLE deposit_addresses
            ADD CONSTRAINT deposit_addresses_chain_check
            CHECK (chain IN ('stellar', 'base', 'bitcoin'));
    END IF;
END
$$;
