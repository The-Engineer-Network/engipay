-- Rate Limiting Migration (Issue #498 - Rate limiting across API instances)
-- Moves rate limiter bucket state from in-process memory to Postgres
-- with atomic updates using SELECT FOR UPDATE for concurrent safety.

-- Create rate_limits table to store bucket state persistently
CREATE TABLE IF NOT EXISTS rate_limits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key             TEXT NOT NULL,        -- IP address or user ID (the rate limit key)
    bucket_key      TEXT NOT NULL,        -- Identifier for the bucket (e.g., "public", "auth")
    tokens          INTEGER NOT NULL DEFAULT 60,  -- Current remaining tokens
    max_tokens      INTEGER NOT NULL DEFAULT 60,  -- Maximum tokens allowed
    rate            INTEGER NOT NULL DEFAULT 1,   -- Tokens replenished per second
    last_refill     TIMESTAMPTZ NOT NULL DEFAULT now(), -- Last refill timestamp
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Ensure each key+bucket combination has at most one active bucket
    UNIQUE (key, bucket_key)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits (key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_last_refill ON rate_limits (last_refill);

-- Comment to document the table
COMMENT ON TABLE rate_limits IS 'Postgres-backed rate limiter bucket state for cross-instance rate limiting';
COMMENT ON COLUMN rate_limits.key IS 'Rate limit key, typically IP address or user ID';
COMMENT ON COLUMN rate_limits.bucket_key IS 'Bucket identifier, e.g., "public" for general rate limit, "auth" for authenticated';
COMMENT ON COLUMN rate_limits.tokens IS 'Current remaining tokens in the bucket';
COMMENT ON COLUMN rate_limits.max_tokens IS 'Maximum tokens allowed before rate limit kicks in';
COMMENT ON COLUMN rate_limits.rate IS 'Tokens replenished per second';
COMMENT ON COLUMN rate_limits.last_refill IS 'Timestamp of last token refill';