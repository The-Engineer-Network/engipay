-- Payment request partial-payment support (#479).
--
-- Adds three columns to payment_requests:
--   allow_partial  – when true, payments smaller than requested_amount are accepted.
--   min_amount     – if set, each individual payment must be at least this large.
--   max_amount     – if set, individual payments may not exceed this amount.
--
-- Adds a new table payment_request_payments that records every payment received
-- against a request (on-chain or internal).  The request status is derived from
-- this table rather than stored directly, so it can never drift out of sync.
--
-- A new 'partially_paid' status is added to the closed set on payment_requests.
-- All changes are idempotent.

ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS allow_partial BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS min_amount    NUMERIC(78, 0),
    ADD COLUMN IF NOT EXISTS max_amount    NUMERIC(78, 0);

-- Widen the status constraint to include 'partially_paid'.
DO $$
BEGIN
    -- Drop the old narrow constraint; it may exist under either the 0009 name
    -- or an earlier name.  We replace it unconditionally.
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname = 'payment_requests_status_check'
          AND  conrelid = 'payment_requests'::regclass
    ) THEN
        ALTER TABLE payment_requests
            DROP CONSTRAINT payment_requests_status_check;
    END IF;

    ALTER TABLE payment_requests
        ADD CONSTRAINT payment_requests_status_check
        CHECK (status IN ('pending', 'partially_paid', 'paid', 'expired'));
END
$$;

-- min_amount must be positive when present.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname = 'payment_requests_min_amount_check'
          AND  conrelid = 'payment_requests'::regclass
    ) THEN
        ALTER TABLE payment_requests
            ADD CONSTRAINT payment_requests_min_amount_check
            CHECK (min_amount IS NULL OR min_amount > 0);
    END IF;
END
$$;

-- max_amount must be positive and >= min_amount when both are set.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE  conname = 'payment_requests_max_amount_check'
          AND  conrelid = 'payment_requests'::regclass
    ) THEN
        ALTER TABLE payment_requests
            ADD CONSTRAINT payment_requests_max_amount_check
            CHECK (
                max_amount IS NULL
                OR (
                    max_amount > 0
                    AND (min_amount IS NULL OR max_amount >= min_amount)
                )
            );
    END IF;
END
$$;

-- Each payment received against a payment request.
-- `chain` identifies where the payment came from (e.g. 'stellar', 'base',
-- 'bitcoin', 'internal').  `tx_hash` is the on-chain transaction id (NULL for
-- internal payments).  `payer_address` is the sender's wallet or user id.
-- Amounts are NUMERIC(78,0) minor units, same as the ledger.
CREATE TABLE IF NOT EXISTS payment_request_payments (
    id                  UUID PRIMARY KEY,
    payment_request_id  UUID NOT NULL REFERENCES payment_requests (id),
    amount              NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    asset               TEXT NOT NULL CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC')),
    chain               TEXT NOT NULL,
    tx_hash             TEXT,
    payer_address       TEXT,
    note                TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_request_payments_request
    ON payment_request_payments (payment_request_id, created_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_request_payments_tx_hash
    ON payment_request_payments (chain, tx_hash)
    WHERE tx_hash IS NOT NULL;
