-- Migration 0008: chain-service support tables.
--
-- chain_cursors: persists the Horizon paging token so the Stellar watcher
-- can resume from exactly where it stopped after a restart, avoiding both
-- missed and duplicate deposits.
--
-- deposit_addresses: maps a Stellar muxed-account ID (64-bit, stored as
-- BIGINT using the same bit-pattern) to the internal user UUID.  Each row
-- is written once when the user's deposit address is provisioned and never
-- changes.

CREATE TABLE chain_cursors (
    chain       TEXT        NOT NULL,
    cursor      TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain)
);

COMMENT ON TABLE  chain_cursors          IS 'Persists the last processed paging token per chain so the watcher can resume after a restart.';
COMMENT ON COLUMN chain_cursors.chain    IS 'Short chain identifier, e.g. ''stellar''.';
COMMENT ON COLUMN chain_cursors.cursor   IS 'Horizon paging token (TOID as decimal string) of the last processed operation.';
COMMENT ON COLUMN chain_cursors.updated_at IS 'Wall-clock time of the last successful cursor advance.';

-- The canonical table was created by 0005 and extended by 0007.
ALTER TABLE deposit_addresses ALTER COLUMN id SET DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX deposit_addresses_chain_muxed_id_key ON deposit_addresses (chain, muxed_id);

COMMENT ON TABLE  deposit_addresses          IS 'One row per user deposit address, keyed by chain and muxed ID.';
COMMENT ON COLUMN deposit_addresses.muxed_id IS 'Stellar 64-bit muxed account ID, bit-cast to BIGINT.  NULL for chains that do not use muxed addresses.';
