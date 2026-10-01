-- Payment requests: invoices a recipient shares to get paid.
--
-- 0001_ledger.sql already creates payment_requests in an earlier shape
-- (user_id, amount, note, uri). An earlier version of this migration used
-- CREATE TABLE IF NOT EXISTS, which silently kept that shape, so the columns
-- the API reads (recipient_id, requested_amount, status, ...) never existed.
-- This brings the existing table to the shape the API uses instead.

ALTER TABLE payment_requests RENAME COLUMN user_id TO recipient_id;
ALTER TABLE payment_requests RENAME COLUMN amount TO requested_amount;
-- The URI is derived from the row; older rows keep theirs.
ALTER TABLE payment_requests ALTER COLUMN uri DROP NOT NULL;

ALTER TABLE payment_requests DROP CONSTRAINT payment_requests_asset_check;
ALTER TABLE payment_requests ADD CONSTRAINT payment_requests_asset_check
    CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC'));

ALTER TABLE payment_requests
    ADD COLUMN recipient_tag     TEXT,
    ADD COLUMN status            TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'expired')),
    ADD COLUMN settled_at        TIMESTAMPTZ,
    ADD COLUMN payment_reference TEXT UNIQUE;

ALTER INDEX payment_requests_by_user RENAME TO idx_payment_requests_recipient;
CREATE INDEX idx_payment_requests_status ON payment_requests (status, expires_at);
