-- Point-in-time balances and historical snapshots (issue #507).
--
-- Two problems are solved here:
--
-- 1. As-of queries (balance at a past moment)
--    Without an index, computing the balance at time T requires summing
--    every posting ever written for a user.  The partial index below
--    makes the WHERE clause "created_at <= $as_of" cheap even on a large
--    ledger.
--
--    Benchmark shape (run against a synthetic ledger with 1 M postings):
--
--      EXPLAIN (ANALYSE, BUFFERS)
--        SELECT COALESCE(SUM(amount), 0)
--        FROM ledger_postings
--        WHERE owner_kind = 'user'
--          AND user_id    = '<uuid>'
--          AND asset      = 'USDC'
--          AND bucket     = 'available'
--          AND created_at <= '<timestamp>';
--
--    Expected plan: Index Scan on ledger_postings_by_user_asset_time
--    (the index below).  Without the index the planner falls back to a
--    sequential scan of the whole table.  With the index the scan is
--    bounded to the rows for (user, asset, bucket) up to the requested
--    timestamp.
--
-- 2. Balance snapshots
--    Periodic snapshots let an as-of query start from a known balance
--    instead of replaying the full history.  The query becomes:
--
--      latest snapshot before T  +  postings written after snapshot and before T
--
--    This bounds the number of postings scanned to the interval since
--    the last snapshot, regardless of ledger age.

-- ── Index for as-of queries ────────────────────────────────────────────
--
-- Covers the five columns referenced by every point-in-time query.
-- The existing index `ledger_postings_by_user_asset` does not include
-- `created_at`, so the planner cannot use it to restrict time.
CREATE INDEX ledger_postings_by_user_asset_time
    ON ledger_postings (user_id, asset, bucket, created_at)
    WHERE owner_kind = 'user';

-- ── balance_snapshots table ────────────────────────────────────────────
--
-- Each row captures the exact balance of one (user, asset, bucket) pair
-- at a particular moment.  Rows are written by the periodic snapshot
-- worker (or an admin job) and never mutated afterwards.
CREATE TABLE balance_snapshots (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         UUID            NOT NULL REFERENCES users (id),
    asset           TEXT            NOT NULL
                        CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM')),
    bucket          TEXT            NOT NULL
                        CHECK (bucket IN ('available', 'held')),
    -- Balance in the asset's smallest unit at the moment `snapshotted_at`.
    balance         NUMERIC(78, 0)  NOT NULL,
    -- The moment this balance was captured.  As-of queries use this as
    -- the starting cursor: sum postings where created_at > snapshotted_at
    -- AND created_at <= as_of.
    snapshotted_at  TIMESTAMPTZ     NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Retrieve the most-recent snapshot before a given moment, per user/asset/bucket.
CREATE INDEX balance_snapshots_lookup
    ON balance_snapshots (user_id, asset, bucket, snapshotted_at DESC);

-- ── Helper function: take_balance_snapshot ────────────────────────────
--
-- Computes the current balance from postings and writes one snapshot row
-- per (asset, bucket) pair for the given user.  Idempotent in the sense
-- that multiple calls each write a new, timestamped snapshot (old ones
-- are kept for history).
--
-- Usage: SELECT take_balance_snapshot('<user_uuid>');
CREATE FUNCTION take_balance_snapshot(p_user_id UUID)
RETURNS SETOF balance_snapshots
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    INSERT INTO balance_snapshots (user_id, asset, bucket, balance, snapshotted_at)
    SELECT
        p_user_id,
        asset,
        bucket,
        COALESCE(SUM(amount), 0),
        now()
    FROM ledger_postings
    WHERE owner_kind = 'user'
      AND user_id    = p_user_id
    GROUP BY asset, bucket
    RETURNING *;
END;
$$;
