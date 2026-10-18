-- Migration 0015: Naira buy quotes and orders.
--
-- A quote fixes the price of a buy for a short window (see QUOTE_LIFETIME in
-- services/buy.rs). An order is created from one quote, at most once. Orders
-- start as 'awaiting_partner': no Naira partner is connected yet, so no
-- payment is collected and no balance is credited. Nothing here touches the
-- ledger.

CREATE TABLE IF NOT EXISTS buy_quotes (
    id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID           NOT NULL REFERENCES users (id),
    asset           TEXT           NOT NULL CHECK (asset IN ('USDC')),
    -- Naira in kobo (1/100 naira), before the fee.
    naira_kobo      NUMERIC(78, 0) NOT NULL CHECK (naira_kobo > 0),
    fee_kobo        NUMERIC(78, 0) NOT NULL CHECK (fee_kobo >= 0),
    -- Amount the user receives, in the asset's smallest unit.
    receive_minor   NUMERIC(78, 0) NOT NULL CHECK (receive_minor > 0),
    -- Kobo that buy one whole unit of the asset, as priced at quote time.
    kobo_per_unit   NUMERIC(78, 0) NOT NULL CHECK (kobo_per_unit > 0),
    fee_bps         INTEGER        NOT NULL CHECK (fee_bps BETWEEN 0 AND 9999),
    expires_at      TIMESTAMPTZ    NOT NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buy_quotes_user_idx ON buy_quotes (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS buy_orders (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- One order per quote: the UNIQUE constraint stops a quote being spent twice.
    quote_id    UUID        NOT NULL UNIQUE REFERENCES buy_quotes (id),
    user_id     UUID        NOT NULL REFERENCES users (id),
    status      TEXT        NOT NULL DEFAULT 'awaiting_partner'
                    CHECK (status IN ('awaiting_partner')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buy_orders_user_idx ON buy_orders (user_id, created_at DESC);
