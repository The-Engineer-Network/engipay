-- Transactional outbox for domain events (issue #496).
--
-- outbox_events is written inside the same database transaction as the ledger
-- change that produces the event.  Because it shares the same transaction, a
-- rollback discards the event row too, so rolled-back changes emit nothing.
--
-- The relay worker reads unpublished rows in (aggregate_id, sequence) order,
-- publishes each event to the message broker, and then marks it published.  A
-- crash between publish and mark causes at-most-once delivery from the relay
-- side; consumers must deduplicate by event_id (see outbox_consumed).
--
-- Ordering guarantee: within a single aggregate_id, events are delivered in
-- insertion order because the relay advances its position only after a
-- successful publish, and rows are fetched ORDER BY aggregate_id, sequence.

CREATE TABLE outbox_events (
    -- Globally unique identifier for this event; consumers use it to
    -- deduplicate (upsert into outbox_consumed).
    id              UUID        PRIMARY KEY,
    -- Logical grouping for ordered delivery.  For ledger events this is the
    -- ledger_transaction id, so all postings for one transaction travel in order.
    aggregate_id    UUID        NOT NULL,
    -- Monotonically increasing within an aggregate; used as the relay cursor.
    sequence        BIGSERIAL   NOT NULL,
    -- The event type, e.g. 'funds_deposited', 'transfer_completed'.
    event_type      TEXT        NOT NULL CHECK (length(event_type) > 0),
    -- Canonical JSON payload.  NULL is intentionally not allowed; an empty
    -- object '{}' should be used when there is nothing to say.
    payload         JSONB       NOT NULL,
    -- The ledger_transactions reference associated with this event, for
    -- human-readable correlation.
    ledger_ref      TEXT,
    -- NULL until the relay marks the row as published.
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The relay scans for unpublished rows ordered by sequence.
CREATE INDEX outbox_events_unpublished
    ON outbox_events (sequence)
    WHERE published_at IS NULL;

-- Per-aggregate ordered scan (used when replaying a single aggregate).
CREATE INDEX outbox_events_by_aggregate
    ON outbox_events (aggregate_id, sequence);

-- Consumer deduplication table.  Each consumer (identified by consumer_name)
-- records every event_id it has successfully processed.  Before processing an
-- event the consumer INSERTs with ON CONFLICT DO NOTHING; if nothing was
-- inserted the event has already been handled and should be skipped.
CREATE TABLE outbox_consumed (
    consumer_name   TEXT        NOT NULL,
    event_id        UUID        NOT NULL REFERENCES outbox_events (id),
    consumed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, event_id)
);

-- The relay stores its position per named relay instance so multiple relay
-- workers can be deployed without racing (each covers a distinct shard, or a
-- single relay is named 'default').
CREATE TABLE outbox_relay_cursor (
    relay_name      TEXT        PRIMARY KEY,
    -- The highest outbox_events.sequence that has been successfully published.
    -- NULL means "nothing published yet".
    last_sequence   BIGINT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single default relay cursor so the worker can do a simple UPDATE
-- instead of an upsert on every tick.
INSERT INTO outbox_relay_cursor (relay_name, last_sequence)
VALUES ('default', NULL);
