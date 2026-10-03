-- Entity tables for deposit addresses, bank accounts, conversions, and ramp orders.

CREATE TABLE deposit_addresses (
    id               UUID PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users (id),
    chain            TEXT NOT NULL CHECK (chain IN ('stellar', 'base', 'bitcoin')),
    address          TEXT NOT NULL UNIQUE,
    muxed_id         BIGINT,
    derivation_index INT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, chain)
);

CREATE TABLE bank_accounts (
    id             UUID PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users (id),
    bank_code      TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_name   TEXT NOT NULL,
    verified       BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, bank_code, account_number)
);

CREATE TABLE conversions (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users (id),
    asset_in    TEXT NOT NULL,
    asset_out   TEXT NOT NULL,
    amount_in   NUMERIC(78, 0) NOT NULL,
    amount_out  NUMERIC(78, 0) NOT NULL,
    rate        NUMERIC NOT NULL,
    fee         NUMERIC(78, 0) NOT NULL,
    route       TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('quoted', 'processing', 'completed', 'failed', 'expired')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX conversions_by_user ON conversions (user_id, created_at DESC);

CREATE TABLE ramp_orders (
    id             UUID PRIMARY KEY,
    user_id        UUID NOT NULL REFERENCES users (id),
    direction      TEXT NOT NULL CHECK (direction IN ('on_ramp', 'off_ramp')),
    asset          TEXT NOT NULL,
    crypto_amount  NUMERIC(78, 0) NOT NULL,
    ngn_amount     NUMERIC(18, 2) NOT NULL,
    rate           NUMERIC NOT NULL,
    fee            NUMERIC(78, 0) NOT NULL,
    partner        TEXT NOT NULL,
    partner_ref    TEXT UNIQUE,
    status         TEXT NOT NULL CHECK (status IN ('quoted', 'awaiting_payment', 'processing', 'completed', 'failed', 'expired', 'refunded')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ
);

CREATE INDEX ramp_orders_by_partner_ref ON ramp_orders (partner, partner_ref);
CREATE INDEX ramp_orders_by_user ON ramp_orders (user_id, created_at DESC);
