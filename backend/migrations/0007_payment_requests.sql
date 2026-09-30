-- Payment requests schema for invoicing and payment polling.
-- Payment requests are invoices that recipients can share for receiving payments.

CREATE TABLE IF NOT EXISTS payment_requests (
    id              UUID PRIMARY KEY,
    recipient_id    UUID NOT NULL REFERENCES users (id),
    recipient_tag   TEXT,
    requested_amount NUMERIC(78, 0) NOT NULL CHECK (requested_amount > 0),
    asset           TEXT NOT NULL CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC')),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    settled_at      TIMESTAMPTZ,
    payment_reference TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_recipient
    ON payment_requests (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status
    ON payment_requests (status, expires_at);
