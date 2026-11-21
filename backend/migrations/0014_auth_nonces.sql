-- Sign-in nonces. Each nonce is issued once, is valid for five minutes, and
-- can be used by exactly one successful sign-in (consumed_at is set then).

CREATE TABLE IF NOT EXISTS auth_nonces (
    nonce        TEXT        PRIMARY KEY,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ NOT NULL,
    consumed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_expires_at ON auth_nonces (expires_at);

COMMENT ON TABLE auth_nonces IS 'Single-use sign-in nonces for wallet login. Rows are kept after use so a replayed nonce is refused rather than unknown.';
