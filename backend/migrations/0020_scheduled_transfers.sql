-- Migration 0020: scheduled and recurring transfers between EngiPay users.
--
-- A schedule produces one occurrence per due date. Each occurrence has one row
-- in scheduled_transfer_runs, unique on (schedule_id, run_on). The ledger
-- transfer for an occurrence uses the reference "sched:<schedule_id>:<run_on>",
-- which the ledger treats as idempotent. So a crash between moving money and
-- recording the run replays the same transfer and never pays twice.

CREATE TABLE IF NOT EXISTS scheduled_transfers (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       UUID           NOT NULL REFERENCES users (id),
    recipient_id    UUID           NOT NULL REFERENCES users (id),
    asset           TEXT           NOT NULL CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM')),
    -- Amount in the asset's smallest unit, as in ledger postings.
    amount_minor    NUMERIC(78, 0) NOT NULL CHECK (amount_minor > 0),
    cadence         TEXT           NOT NULL CHECK (cadence IN ('once', 'weekly', 'monthly')),
    -- The day of month the schedule was set up on. Monthly occurrences use it
    -- and clamp to the last day of short months, so Jan 31 gives Feb 28 and
    -- then Mar 31 again.
    anchor_day      SMALLINT       NOT NULL CHECK (anchor_day BETWEEN 1 AND 31),
    next_run_on     DATE           NOT NULL,
    status          TEXT           NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'completed', 'cancelled')),
    -- A worker holds a schedule while it works on it, so two workers never run
    -- the same occurrence at once. Expires on its own if the worker dies.
    claimed_until   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CHECK (sender_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS scheduled_transfers_due_idx
    ON scheduled_transfers (next_run_on)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS scheduled_transfers_sender_idx
    ON scheduled_transfers (sender_id, created_at DESC);

-- One row per occurrence. The unique key is what stops an occurrence from
-- being recorded twice.
CREATE TABLE IF NOT EXISTS scheduled_transfer_runs (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id     UUID        NOT NULL REFERENCES scheduled_transfers (id),
    run_on          DATE        NOT NULL,
    outcome         TEXT        NOT NULL CHECK (outcome IN ('sent', 'skipped')),
    -- Set when outcome = 'sent': the ledger transaction that moved the money.
    transaction_id  UUID,
    -- Set when outcome = 'skipped': why this occurrence did not go out.
    skip_reason     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (schedule_id, run_on),
    CHECK (
        (outcome = 'sent' AND transaction_id IS NOT NULL AND skip_reason IS NULL)
        OR (outcome = 'skipped' AND transaction_id IS NULL AND skip_reason IS NOT NULL)
    )
);
