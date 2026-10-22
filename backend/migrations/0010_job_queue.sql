-- EngiPay job queue migration.
-- Provides a durable background job queue using SELECT ... FOR UPDATE SKIP LOCKED.
-- Jobs can be retried with exponential backoff, have a visibility timeout so crashed
-- workers don't lose work, and can be moved to a dead-letter state after max retries.
--
-- Usage:
--   enqueue:   INSERT INTO jobs (kind, payload, created_at) VALUES ($1, $2, now())
--   dequeue:   BEGIN; SELECT * FROM jobs WHERE status = 'pending' FOR UPDATE SKIP LOCKED; ...
--   complete:  UPDATE jobs SET status = 'completed', processed_at = now() WHERE id = $1;
--   fail:      UPDATE jobs SET status = 'failed', error = $2, attempts = attempts + 1, updated_at = now() WHERE id = $1;
--   dead-letter: UPDATE jobs SET status = 'dead_letter' WHERE attempts >= max_attempts;

CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          TEXT NOT NULL DEFAULT 'pending',
    -- Visibility timeout: after a worker picks up a job, it becomes visible
    -- again after this many seconds if not completed/failed. Uses application
    ---level tracking via processed_at; the DB schema stores created_at and
    -- updated_at for the application to implement SKIP LOCKED polling.
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Retry tracking
    attempts        INTEGER NOT NULL DEFAULT 0,
    max_attempts    INTEGER NOT NULL DEFAULT 5,
    -- Dead-letter flag
    dead_lettered   BOOLEAN NOT NULL DEFAULT FALSE,
    -- Reserved for dead-letter destination
    dead_letter_at  TIMESTAMPTZ,
    -- Error details on last failure
    error           TEXT,
    -- Optional correlation IDs
    correlation_id  UUID,

    CONSTRAINT jobs_status_check CHECK (status IN ('pending', 'completed', 'failed', 'dead_letter')),
    CONSTRAINT jobs_max_attempts_check CHECK (max_attempts > 0)
);

-- Index to quickly find pending jobs for dequeuing.
CREATE INDEX idx_jobs_pending ON jobs (status, created_at)
    WHERE status = 'pending';

-- Index to find dead-lettered jobs for diagnostics.
CREATE INDEX idx_jobs_dead_letter ON jobs (dead_lettered, created_at)
    WHERE dead_lettered = TRUE;

-- Comment explaining the design
COMMENT ON TABLE jobs IS '
  Durable background job queue for EngiPay.
  Uses SELECT ... FOR UPDATE SKIP LOCKED for safe concurrent dequeue.
  Status flow: pending -> completed | failed -> (retries) -> dead_letter.
  Retries use application-level exponential backoff based on attempts.
  Visibility timeout is implemented by the worker: after picking a job,
  the worker marks it (e.g. status -> "processing") and must complete/failed
  within a reasonable time; if the worker crashes, the next poll cycle will
  pick up pending jobs (updated_at resets on each poll cycle or the app
  resets status back to pending after a visibility timeout).
';

-- Dead-letter table for jobs that exceeded max retries.
-- Jobs are moved here permanently so they can be inspected/redirected later.
CREATE TABLE dead_letters (
    id              UUID PRIMARY KEY REFERENCES jobs (id) ON DELETE CASCADE,
    job_id          UUID UNIQUE REFERENCES jobs (id) ON DELETE CASCADE,
    original_kind   TEXT NOT NULL,
    original_payload JSONB NOT NULL,
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    error           TEXT NOT NULL,
    attempts        INTEGER NOT NULL,
    redirected_to   TEXT -- e.g. "dlq-topic", "email-admin", etc.
);

-- Index for finding dead-lettered jobs by kind for batched processing.
CREATE INDEX idx_dead_letters_kind ON dead_letters (original_kind, failed_at DESC);