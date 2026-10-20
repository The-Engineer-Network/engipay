-- 0019_payment_request_splits.sql
-- Issue #483: Split a bill across several payers
-- Adds split-share tracking for payment requests.

-- Add split_mode to payment_requests (NULL = not a split request).
ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS split_mode TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'payment_requests_split_mode_check'
          AND conrelid = 'payment_requests'::regclass
    ) THEN
        ALTER TABLE payment_requests
            ADD CONSTRAINT payment_requests_split_mode_check
            CHECK (split_mode IS NULL OR split_mode IN ('equal', 'custom'));
    END IF;
END
$$;

-- Per-payer shares for a split payment request.
CREATE TABLE IF NOT EXISTS payment_request_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_request_id UUID NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
    payer_identifier TEXT NOT NULL,
    amount NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    paid_amount NUMERIC(78, 0) NOT NULL DEFAULT 0
        CHECK (paid_amount >= 0 AND paid_amount <= amount),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One share per payer per payment request.
CREATE UNIQUE INDEX IF NOT EXISTS payment_request_shares_request_payer_uniq
    ON payment_request_shares (payment_request_id, payer_identifier);

-- Fast lookup of all shares for a payment request.
CREATE INDEX IF NOT EXISTS payment_request_shares_request_id_idx
    ON payment_request_shares (payment_request_id);