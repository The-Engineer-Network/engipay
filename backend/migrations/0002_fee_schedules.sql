-- Fee schedules for every EngiPay product.
--
-- Design goals:
--   * A schedule is versioned by its id (UUID v4) so a quote can be pinned to
--     the exact schedule it was computed from.  Changing the schedule after a
--     quote is issued never alters that quote, because settlement checks the
--     version it received.
--   * effective_from lets operators schedule rate changes ahead of time without
--     a deployment.  The active schedule for a (product, asset) pair is the row
--     with the largest effective_from that is <= now().
--   * Amounts are stored as NUMERIC(78,0) – the same minor-unit convention as
--     the ledger – so there is never any floating-point involved.
--   * The table is append-only (same as the ledger): new schedules are INSERTs,
--     never UPDATEs, preserving a full history of what fee was in effect when.

CREATE TABLE fee_schedules (
    -- Stable identifier included in every quote so settlement can verify it.
    id              UUID PRIMARY KEY,
    -- Which product this schedule applies to.
    -- 'transfer', 'withdrawal', 'conversion', 'buy', 'sell'
    product         TEXT NOT NULL CHECK (product IN ('transfer', 'withdrawal', 'conversion', 'buy', 'sell')),
    -- Which asset this schedule denominates its fees in.
    asset           TEXT NOT NULL CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM')),
    -- Flat fee in the asset's smallest units (0 for none).
    fixed_minor     NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (fixed_minor >= 0),
    -- Percentage of the gross amount, stored as basis points (1 bp = 0.01%).
    -- E.g. 30 = 0.30 %.  0 for no percentage component.
    bps             INTEGER NOT NULL DEFAULT 0 CHECK (bps >= 0),
    -- Floor on the percentage component in the asset's smallest units (0 for none).
    min_fee_minor   NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (min_fee_minor >= 0),
    -- Cap on the total fee in the asset's smallest units (NULL = no cap).
    max_fee_minor   NUMERIC(78, 0) CHECK (max_fee_minor IS NULL OR max_fee_minor > 0),
    -- When this schedule becomes active.  Schedules are NOT updated; to change
    -- a fee, insert a new row with a later effective_from.
    effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup of the current schedule for a (product, asset) pair.
CREATE INDEX fee_schedules_lookup
    ON fee_schedules (product, asset, effective_from DESC);

-- Quotes are issued by the API and must never change after they are created.
-- The schedule_version is the fee_schedules.id at the moment of quoting.
-- Settlement rejects a quote whose version no longer exists or has been
-- superseded (it will not – the row is immutable – but the application checks
-- the version string it stored matches what it originally saw).
CREATE TABLE quotes (
    id               UUID PRIMARY KEY,
    product          TEXT NOT NULL CHECK (product IN ('transfer', 'withdrawal', 'conversion', 'buy', 'sell')),
    asset            TEXT NOT NULL CHECK (asset IN ('ETH', 'USDC', 'BTC', 'XLM')),
    -- Amount the user wants to send/convert/withdraw (before fees).
    gross_minor      NUMERIC(78, 0) NOT NULL CHECK (gross_minor > 0),
    -- Fee computed at quote time, in the same asset.
    fee_minor        NUMERIC(78, 0) NOT NULL CHECK (fee_minor >= 0),
    -- The exact schedule row that produced this fee.
    schedule_version UUID NOT NULL REFERENCES fee_schedules (id),
    -- Quotes expire; a client that delays too long must re-quote.
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only: quotes are immutable once created.
CREATE FUNCTION quotes_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'quotes are append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER quotes_append_only
    BEFORE UPDATE OR DELETE ON quotes
    FOR EACH ROW EXECUTE FUNCTION quotes_append_only();

-- Append-only: fee schedules are immutable once created.
CREATE FUNCTION fee_schedules_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'fee schedules are append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER fee_schedules_append_only
    BEFORE UPDATE OR DELETE ON fee_schedules
    FOR EACH ROW EXECUTE FUNCTION fee_schedules_append_only();

-- Audit trail for fee settlements.  Each hold may be settled at most once;
-- the UNIQUE constraint on settle_reference enforces idempotency (same as the
-- ledger's reference uniqueness).  The schedule_version links back to the
-- fee_schedules row so reconciliation can always reproduce how the fee was
-- computed.
CREATE TABLE quote_settles (
    id                BIGSERIAL PRIMARY KEY,
    -- '<hold_reference>:settle' – unique per hold.
    settle_reference  TEXT NOT NULL UNIQUE CHECK (length(btrim(settle_reference)) > 0),
    quote_id          UUID NOT NULL REFERENCES quotes (id),
    -- Fee booked to the Fees system account, in the quote's asset's smallest units.
    fee_minor         NUMERIC(78, 0) NOT NULL CHECK (fee_minor >= 0),
    -- The fee_schedules row that priced this settlement.
    schedule_version  UUID NOT NULL REFERENCES fee_schedules (id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the initial production schedule with conservative rates.
-- All amounts are in the asset's smallest unit (7-decimal USDC here).
INSERT INTO fee_schedules (id, product, asset, fixed_minor, bps, min_fee_minor, max_fee_minor, effective_from)
VALUES
    -- Transfers: flat 0.10 USDC, no percentage.
    ('00000000-0000-0000-0000-000000000001', 'transfer',   'USDC', 1000000,   0,  0,       NULL,         '2025-01-01 00:00:00+00'),
    -- Withdrawals: 0.50 USDC flat + 0.30 % (min 0.50 USDC, max 10 USDC).
    ('00000000-0000-0000-0000-000000000002', 'withdrawal',  'USDC', 5000000,  30,  5000000, 100000000,    '2025-01-01 00:00:00+00'),
    -- Conversions: 0.30 % (min 0.10 USDC, max 5 USDC).
    ('00000000-0000-0000-0000-000000000003', 'conversion',  'USDC', 0,        30,  1000000, 50000000,     '2025-01-01 00:00:00+00'),
    -- Buy (Naira → crypto): 1.00 % (min 0.50 USDC).
    ('00000000-0000-0000-0000-000000000004', 'buy',         'USDC', 0,       100,  5000000, NULL,         '2025-01-01 00:00:00+00'),
    -- Sell (crypto → Naira): 1.00 % (min 0.50 USDC).
    ('00000000-0000-0000-0000-000000000005', 'sell',        'USDC', 0,       100,  5000000, NULL,         '2025-01-01 00:00:00+00');
