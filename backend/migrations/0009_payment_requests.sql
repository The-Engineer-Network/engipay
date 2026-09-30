-- Extend the canonical invoice table from 0001 with settlement state.
ALTER TABLE payment_requests
    ADD COLUMN recipient_tag TEXT,
    ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
    ADD COLUMN settled_at TIMESTAMPTZ,
    ADD COLUMN payment_reference TEXT UNIQUE;
ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_asset_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_asset_check CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC'));
CREATE INDEX idx_payment_requests_status ON payment_requests (status, expires_at);
