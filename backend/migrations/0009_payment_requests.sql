-- Payment requests schema for invoicing and payment polling.
-- Payment requests are invoices that recipients can share for receiving payments.
--
-- `0001_ledger.sql` already created `payment_requests` with the columns the
-- merchant/peer request flow inserts (user_id, amount, note, uri).  This
-- migration adds the invoicing columns on top of that table rather than trying
-- to create it again, so the two generations of the endpoint keep working
-- against one table.  Every statement is idempotent: re-running the migration,
-- or applying it to a database that already has these columns, is a no-op.

CREATE TABLE IF NOT EXISTS payment_requests (
    id               UUID PRIMARY KEY,
    recipient_id     UUID REFERENCES users (id),
    recipient_tag    TEXT,
    requested_amount NUMERIC(78, 0),
    asset            TEXT NOT NULL CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC')),
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    settled_at       TIMESTAMPTZ,
    payment_reference TEXT
);

-- The invoicing columns on the 0001 table.  `recipient_id` and
-- `requested_amount` mirror the columns that already exist (`user_id` and
-- `amount`) so both API generations can read and write the same row.
ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS recipient_id      UUID REFERENCES users (id),
    ADD COLUMN IF NOT EXISTS recipient_tag     TEXT,
    ADD COLUMN IF NOT EXISTS requested_amount  NUMERIC(78, 0),
    ADD COLUMN IF NOT EXISTS status            TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS settled_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- Backfill from the 0001 columns, then tighten: a row written by either
-- generation must have both halves populated.
UPDATE payment_requests SET recipient_id     = user_id WHERE recipient_id     IS NULL;
UPDATE payment_requests SET requested_amount = amount   WHERE requested_amount IS NULL;

ALTER TABLE payment_requests
    ALTER COLUMN recipient_id     SET NOT NULL,
    ALTER COLUMN requested_amount SET NOT NULL;

-- Status is a closed set.  Added as a validated constraint so an existing table
-- with a bad row fails loudly instead of silently.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname = 'payment_requests_status_check'
          AND  conrelid = 'payment_requests'::regclass
    ) THEN
        ALTER TABLE payment_requests
            ADD CONSTRAINT payment_requests_status_check
            CHECK (status IN ('pending', 'paid', 'expired'));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname = 'payment_requests_requested_amount_check'
          AND  conrelid = 'payment_requests'::regclass
    ) THEN
        ALTER TABLE payment_requests
            ADD CONSTRAINT payment_requests_requested_amount_check
            CHECK (requested_amount > 0);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_payment_requests_recipient
    ON payment_requests (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status
    ON payment_requests (status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_reference
    ON payment_requests (payment_reference)
    WHERE payment_reference IS NOT NULL;
