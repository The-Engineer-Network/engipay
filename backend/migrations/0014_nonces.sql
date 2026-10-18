-- Sign-in nonce persistence for single-use validation.

CREATE TABLE nonces (
    nonce           TEXT PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,
    UNIQUE(nonce)
);

-- Index for expiry cleanup: find and delete expired nonces
CREATE INDEX idx_nonces_expires_at ON nonces (expires_at);

-- Index for checking if nonce exists and hasn't expired
CREATE INDEX idx_nonces_valid ON nonces (nonce, expires_at) WHERE used_at IS NULL;
