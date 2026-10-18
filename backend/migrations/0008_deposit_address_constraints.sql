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

-- Backfill duplicate derivation_index values before adding the
-- UNIQUE(chain, derivation_index) constraint.  Older code allocated indexes
-- with COUNT(*), so concurrent requests could store the same index.  Keep the
-- lowest row per (chain, derivation_index) and reassign the rest to fresh
-- indexes above the current maximum for that chain.
WITH ranked AS (
    SELECT id,
           chain,
           derivation_index,
           ROW_NUMBER() OVER (
               PARTITION BY chain, derivation_index
               ORDER BY created_at, id
           ) AS rn
    FROM   deposit_addresses
    WHERE  derivation_index IS NOT NULL
),
max_idx AS (
    SELECT chain, MAX(derivation_index) AS max_index
    FROM   deposit_addresses
    WHERE  derivation_index IS NOT NULL
    GROUP BY chain
),
dupes AS (
    SELECT r.id,
           r.chain,
           m.max_index
             + ROW_NUMBER() OVER (PARTITION BY r.chain ORDER BY r.id) AS new_index
    FROM   ranked r
    JOIN   max_idx m ON m.chain = r.chain
    WHERE  r.rn > 1
)
UPDATE deposit_addresses d
SET    derivation_index = dupes.new_index
FROM   dupes
WHERE  d.id = dupes.id;

-- Add UNIQUE(chain, derivation_index): derivation indexes are unique per chain.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM   pg_constraint
        WHERE  conname = 'deposit_addresses_chain_derivation_index_key'
          AND  conrelid = 'deposit_addresses'::regclass
    ) THEN
        ALTER TABLE deposit_addresses
            ADD CONSTRAINT deposit_addresses_chain_derivation_index_key
            UNIQUE (chain, derivation_index);
    END IF;
END
$$;
