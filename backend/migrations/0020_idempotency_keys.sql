-- Idempotency keys for POST endpoints.
--
-- Clients send an `Idempotency-Key` header with every POST. On the first call
-- the server inserts a row here, runs the handler, and stores the final
-- response. On any replay the stored response is returned verbatim.  If the
-- key is reused with a different request body the server rejects it with 422.
--
-- Keys expire after 24 hours. An expiry index lets a background job (or the
-- ON CONFLICT path) clean up stale rows without a full table scan.

CREATE TABLE IF NOT EXISTS idempotency_keys (
    -- The caller-supplied opaque string, scoped per authenticated user so two
    -- users can independently use the same key without colliding.
    key          TEXT        NOT NULL,
    -- The user that submitted this request; NULL for unauthenticated POSTs.
    user_id      UUID,
    -- SHA-256 hex digest of the raw request body, used to detect a conflicting
    -- replay (same key, different body → 422).
    request_hash TEXT        NOT NULL,
    -- Stored HTTP response fields so the replay is byte-for-byte identical.
    status_code  INTEGER     NOT NULL,
    response_body JSONB      NOT NULL,
    -- Lifecycle timestamps.
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',

    -- The key is unique per (user, key) pair, not globally, so different
    -- authenticated users can each use "key-1" without conflicting.
    PRIMARY KEY (key, user_id)
);

-- Fast lookup for the expiry cleanup sweep.
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
    ON idempotency_keys (expires_at);

COMMENT ON TABLE idempotency_keys IS
    'POST idempotency: stores the first response for each (key, user) pair. '
    'Replays with the same body receive the cached response; replays with a '
    'different body are rejected with 422. Keys expire after 24 hours.';
