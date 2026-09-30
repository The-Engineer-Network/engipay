-- Persist the incoming chain service's dead-letter records for investigation.
CREATE TABLE uncredited_deposits (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reason TEXT NOT NULL,
    raw_payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_investigation'
);
