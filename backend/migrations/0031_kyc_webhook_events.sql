-- Tracks received KYC webhook event ids so replayed events are ignored.
CREATE TABLE IF NOT EXISTS kyc_webhook_events (
    provider_event_id TEXT PRIMARY KEY,
    received_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kyc_webhook_events IS 'Deduplication table for KYC provider webhook events.';
