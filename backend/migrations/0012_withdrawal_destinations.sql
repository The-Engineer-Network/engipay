-- Migration 0010: withdrawal destination tracking for cooling-off.
--
-- Records the first time each (user, destination) pair was seen. The
-- cooling_off service in engipay-api uses first_seen_at to decide
-- whether a withdrawal must be held for 24 hours before broadcasting.
--
-- The table is append-only by convention: once a row exists, first_seen_at
-- never changes (the ON CONFLICT DO NOTHING in the application ensures this).

CREATE TABLE IF NOT EXISTS withdrawal_destinations (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users (id),
    destination    TEXT        NOT NULL,
    -- The earliest time this destination was presented for withdrawal by this
    -- user. Never updated after the initial INSERT.
    first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, destination)
);

COMMENT ON TABLE  withdrawal_destinations IS 'Tracks when each withdrawal destination address was first seen per user, for cooling-off enforcement.';
COMMENT ON COLUMN withdrawal_destinations.first_seen_at IS 'The timestamp of the first withdrawal attempt to this address. Never updated after initial insert.';
