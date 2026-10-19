-- Migration 0019: notification outbox and channel preferences.
--
-- An event is written here in the same database transaction that records the
-- thing that happened, so an event cannot be lost. A separate delivery step
-- sends each row and marks it sent.
--
-- One row per (event, channel). UNIQUE (dedupe_key, channel) means enqueueing
-- the same event twice, for example after a crash and retry, adds nothing.

CREATE TABLE IF NOT EXISTS notification_outbox (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users (id),
    event_kind      TEXT        NOT NULL CHECK (char_length(event_kind) BETWEEN 1 AND 64),
    channel         TEXT        NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
    dedupe_key      TEXT        NOT NULL CHECK (char_length(dedupe_key) BETWEEN 1 AND 200),
    title           TEXT        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body            TEXT        NOT NULL CHECK (char_length(body) <= 2000),
    state           TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending', 'sent', 'failed')),
    attempts        INTEGER     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error      TEXT,
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dedupe_key, channel)
);

-- The delivery worker scans for pending rows that are due.
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
    ON notification_outbox (next_attempt_at)
    WHERE state = 'pending';

-- A channel a user has switched off. No row means the channel is on.
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id     UUID        NOT NULL REFERENCES users (id),
    channel     TEXT        NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'push')),
    enabled     BOOLEAN     NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, channel)
);
