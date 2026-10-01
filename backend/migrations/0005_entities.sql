-- Extended entities schema for EngiPay (Epic 1: DB-03).
-- Includes user profiles, deposit addresses, bank accounts, token conversions,
-- ramp orders, and deduplicated partner webhook events.

-- user_profiles is created in 0003_auth.sql, keyed by `id` with a `tier`
-- column, which is what the API writes on first sign-in. This migration adds
-- the profile fields the rest of the product needs, rather than declaring a
-- second, conflicting table.
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS tag        TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS email      TEXT,
    ADD COLUMN IF NOT EXISTS phone      TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_tag_lower
    ON user_profiles (LOWER(btrim(tag))) WHERE tag IS NOT NULL;

CREATE TABLE IF NOT EXISTS deposit_addresses (
    id                UUID PRIMARY KEY,
    user_id           UUID NOT NULL REFERENCES users (id),
    chain             TEXT NOT NULL CHECK (chain IN ('stellar', 'base', 'bitcoin')),
    address           TEXT NOT NULL UNIQUE,
    muxed_id          BIGINT,
    derivation_index  INT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, chain)
);

CREATE TABLE IF NOT EXISTS bank_accounts (
    id              UUID PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users (id),
    bank_code       TEXT NOT NULL CHECK (length(btrim(bank_code)) > 0),
    account_number  TEXT NOT NULL CHECK (length(btrim(account_number)) > 0),
    account_name    TEXT NOT NULL CHECK (length(btrim(account_name)) > 0),
    verified        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, bank_code, account_number)
);

CREATE TABLE IF NOT EXISTS conversions (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users (id),
    asset_in    TEXT NOT NULL CHECK (length(btrim(asset_in)) > 0),
    asset_out   TEXT NOT NULL CHECK (length(btrim(asset_out)) > 0),
    amount_in   NUMERIC(78, 0) NOT NULL CHECK (amount_in > 0),
    amount_out  NUMERIC(78, 0) NOT NULL CHECK (amount_out >= 0),
    rate        NUMERIC NOT NULL CHECK (rate > 0),
    fee         NUMERIC(78, 0) NOT NULL CHECK (fee >= 0),
    route       TEXT NOT NULL CHECK (length(btrim(route)) > 0),
    status      TEXT NOT NULL CHECK (status IN ('quoted', 'processing', 'completed', 'failed', 'expired')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversions_user_created
    ON conversions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ramp_orders (
    id             UUID PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users (id),
    direction      TEXT NOT NULL CHECK (direction IN ('on_ramp', 'off_ramp')),
    asset          TEXT NOT NULL CHECK (length(btrim(asset)) > 0),
    crypto_amount  NUMERIC(78, 0) NOT NULL CHECK (crypto_amount > 0),
    ngn_amount     NUMERIC(18, 2) NOT NULL CHECK (ngn_amount > 0),
    rate           NUMERIC NOT NULL CHECK (rate > 0),
    fee            NUMERIC(78, 0) NOT NULL CHECK (fee >= 0),
    partner        TEXT NOT NULL CHECK (length(btrim(partner)) > 0),
    partner_ref    TEXT UNIQUE,
    status         TEXT NOT NULL CHECK (status IN ('quoted', 'awaiting_payment', 'processing', 'completed', 'failed', 'expired', 'refunded')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ramp_orders_partner_ref
    ON ramp_orders (partner, partner_ref);
CREATE INDEX IF NOT EXISTS idx_ramp_orders_user_created
    ON ramp_orders (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
    id            UUID PRIMARY KEY,
    provider      TEXT NOT NULL,
    event_id      TEXT NOT NULL,
    payload       JSONB NOT NULL,
    processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_provider_event
    ON webhook_events (provider, event_id);
