-- Merchant webhook subscriptions and delivery attempts.
-- Merchants can register endpoints and choose which events they want to be notified about.
-- Each subscription has a per-endpoint secret used to HMAC every delivery for integrity
-- and freshness (timestamp protection).

CREATE TABLE IF NOT EXISTS merchant_webhook_subscriptions (
    id            UUID PRIMARY KEY,
    merchant_id   UUID NOT NULL REFERENCES users (id),
    endpoint_url  TEXT NOT NULL,
    events        JSONB NOT NULL DEFAULT '[]',
    secret        TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_webhook_sub_merchant
    ON merchant_webhook_subscriptions (merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_webhook_sub_active
    ON merchant_webhook_subscriptions (is_active);

-- Delivery attempts table: stores every send attempt with response for replay
CREATE TABLE IF NOT EXISTS merchant_webhook_delivery_attempts (
    id               UUID PRIMARY KEY,
    subscription_id  UUID NOT NULL REFERENCES merchant_webhook_subscriptions (id),
    event            TEXT NOT NULL,
    payload          JSONB NOT NULL,
    status_code      INTEGER,
    response_body    JSONB,
    signed_at        TIMESTAMPTZ NOT NULL,
    sent_at          TIMESTAMPTZ,
    retry_count      INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    delivered        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_webhook_del_sub
    ON merchant_webhook_delivery_attempts (subscription_id);

CREATE INDEX IF NOT EXISTS idx_webhook_del_event
    ON merchant_webhook_delivery_attempts (event);

COMMENT ON TABLE merchant_webhook_subscriptions IS
    'Merchant webhook subscriptions: merchants register endpoints and choose events to subscribe to.';
COMMENT ON TABLE merchant_webhook_delivery_attempts IS
    'Every webhook delivery attempt is stored for replay and audit.';