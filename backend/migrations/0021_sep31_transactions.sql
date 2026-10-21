-- Migration: 0021_sep31_transactions
-- Description: Create sep31_transactions table for SEP-31 cross-border payments

CREATE TABLE IF NOT EXISTS sep31_transactions (
    id BIGSERIAL PRIMARY KEY,
    sep31_id VARCHAR(255) NOT NULL UNIQUE,
    sender_id VARCHAR(255) NOT NULL,
    receiver_id VARCHAR(255) NOT NULL,
    asset_code VARCHAR(12) NOT NULL,
    amount_in NUMERIC(20, 7) NOT NULL,
    amount_out NUMERIC(20, 7) NOT NULL,
    status VARCHAR(32) NOT NULL,
    stellar_account_id VARCHAR(56),
    stellar_memo VARCHAR(64),
    stellar_tx_hash VARCHAR(64) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for status polling (anchor queries pending transactions)
CREATE INDEX IF NOT EXISTS idx_sep31_transactions_status
    ON sep31_transactions (status);

-- Index for recipient lookup (credit recipient when payment arrives)
CREATE INDEX IF NOT EXISTS idx_sep31_transactions_receiver_id
    ON sep31_transactions (receiver_id);

-- Index for sender lookup
CREATE INDEX IF NOT EXISTS idx_sep31_transactions_sender_id
    ON sep31_transactions (sender_id);

-- Index for stellar account lookup
CREATE INDEX IF NOT EXISTS idx_sep31_transactions_stellar_account_id
    ON sep31_transactions (stellar_account_id);

-- Composite index for status polling ordered by creation time
CREATE INDEX IF NOT EXISTS idx_sep31_transactions_status_created_at
    ON sep31_transactions (status, created_at);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION update_sep31_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sep31_transactions_updated_at ON sep31_transactions;
CREATE TRIGGER trg_sep31_transactions_updated_at
    BEFORE UPDATE ON sep31_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_sep31_transactions_updated_at();