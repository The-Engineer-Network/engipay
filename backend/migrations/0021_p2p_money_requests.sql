-- P2P money requests: one EngiPay user asks another to pay them.
--
-- Distinct from `payment_requests` (merchant invoicing): those have no named
-- recipient and are fulfilled by on-chain payments.  A money request is between
-- two known users, and accepting it triggers an internal ledger transfer that
-- settles exactly once (idempotency key on the accept path).

CREATE TABLE IF NOT EXISTS p2p_money_requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The user who sent the request ("please pay me").
    requester_id    UUID        NOT NULL REFERENCES users (id),

    -- The user who received the request ("you owe me").
    -- Stored by id; the tag at request time is snapshotted in recipient_tag
    -- so display is stable even if the recipient later changes their tag.
    recipient_id    UUID        NOT NULL REFERENCES users (id),

    -- Snapshot of the recipient's tag at creation time (display only).
    recipient_tag   TEXT,

    asset           TEXT        NOT NULL CHECK (asset IN ('XLM', 'ETH', 'USDC', 'BTC')),

    -- Integer minor units (same Money convention as the rest of the ledger).
    -- Stored as TEXT to keep full i128 precision without Postgres numeric
    -- rounding issues on large values.
    amount          TEXT        NOT NULL CHECK (amount::NUMERIC > 0),

    -- Optional human-readable note from the requester.
    note            TEXT        CHECK (char_length(note) <= 280),

    -- Lifecycle: pending → accepted | declined | expired.
    -- Once a request moves out of pending it is immutable.
    status          TEXT        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),

    -- The ledger transfer that settled this request (set on accept).
    -- Unique so accepting twice (double-tap) cannot create two transfers.
    transfer_id     UUID        UNIQUE REFERENCES ledger_entries (id),

    -- Idempotency key supplied by the acceptor. The accept handler
    -- inserts with ON CONFLICT DO NOTHING on this column so a retry
    -- never pays twice.
    accept_idempotency_key  UUID UNIQUE,

    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Efficient look-up for the inbox: "all pending requests sent to me".
CREATE INDEX IF NOT EXISTS idx_p2p_money_requests_recipient
    ON p2p_money_requests (recipient_id, status, created_at DESC);

-- Efficient look-up for the outbox: "all requests I created".
CREATE INDEX IF NOT EXISTS idx_p2p_money_requests_requester
    ON p2p_money_requests (requester_id, created_at DESC);

-- Enforce the one-payment invariant at the DB level in addition to the
-- application-level idempotency key: a request can only ever be linked to one
-- transfer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_p2p_money_requests_transfer
    ON p2p_money_requests (transfer_id)
    WHERE transfer_id IS NOT NULL;

-- Auto-update updated_at on every row change.
CREATE OR REPLACE FUNCTION set_p2p_money_requests_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_p2p_money_requests_updated_at ON p2p_money_requests;
CREATE TRIGGER trg_p2p_money_requests_updated_at
    BEFORE UPDATE ON p2p_money_requests
    FOR EACH ROW EXECUTE FUNCTION set_p2p_money_requests_updated_at();
