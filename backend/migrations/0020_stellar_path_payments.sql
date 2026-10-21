-- Migration: 0020_stellar_path_payments
-- Cross-asset sends on Stellar via path payments (issue #513).
-- Records what was sent and received for each path payment.

CREATE TABLE IF NOT EXISTS stellar_path_payments (
    id                  BIGSERIAL PRIMARY KEY,
    user_id             BIGINT NOT NULL,
    tx_hash             TEXT NOT NULL UNIQUE,
    source_asset        TEXT NOT NULL,
    source_amount       NUMERIC(30, 7) NOT NULL,
    destination_asset   TEXT NOT NULL,
    destination_amount  NUMERIC(30, 7) NOT NULL,
    slippage_bps        INTEGER NOT NULL,
    quote_id            TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stellar_path_payments_user_id
    ON stellar_path_payments (user_id);

CREATE INDEX IF NOT EXISTS idx_stellar_path_payments_tx_hash
    ON stellar_path_payments (tx_hash);