-- Migration 0018: in-app notification feed.
--
-- Each row is one thing a user should be told about (a deposit arrived, a
-- withdrawal completed, ...). Rows are never deleted by the API; read state
-- is a nullable timestamp so "unread" is `read_at IS NULL`.
--
-- `dedupe_key` makes emitting idempotent: the same event emitted again (for
-- example after a worker restart) hits the UNIQUE constraint and is ignored,
-- so a user never sees the same notification twice.

CREATE TABLE IF NOT EXISTS notifications (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users (id),
    kind        TEXT        NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64),
    title       TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body        TEXT        NOT NULL CHECK (char_length(body) <= 2000),
    dedupe_key  TEXT        NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, dedupe_key)
);

-- Feed order is newest first; the keyset pagination walks this index.
CREATE INDEX IF NOT EXISTS notifications_feed_idx
    ON notifications (user_id, created_at DESC, id DESC);

-- Unread count is the hot query for the badge; keep it cheap.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON notifications (user_id)
    WHERE read_at IS NULL;
