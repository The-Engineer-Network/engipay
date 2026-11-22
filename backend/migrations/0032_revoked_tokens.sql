-- Token revocation list for logout (#630).
--
-- Each row holds one revoked JWT ID and the time it expires so that
-- background cleanup can discard rows that are no longer needed.

CREATE TABLE revoked_tokens (
    jti        TEXT        PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX revoked_tokens_expires_at ON revoked_tokens (expires_at);
