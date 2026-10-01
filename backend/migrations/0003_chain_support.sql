-- Migration 0003: chain-service support tables.
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

CREATE TABLE deposit_addresses (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id),
    chain       TEXT        NOT NULL,
    -- Stellar muxed-account IDs are u64; stored as BIGINT (signed i64) using
    -- the same bit-pattern.  Application code casts with i64::from_ne_bytes /
    -- u64::from_ne_bytes so the round-trip is always exact.
    muxed_id    BIGINT,
    address     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chain, muxed_id),
    UNIQUE (chain, address)
);

COMMENT ON TABLE  deposit_addresses          IS 'One row per user deposit address, keyed by chain and muxed ID.';
COMMENT ON COLUMN deposit_addresses.muxed_id IS 'Stellar 64-bit muxed account ID, bit-cast to BIGINT.  NULL for chains that do not use muxed addresses.';
