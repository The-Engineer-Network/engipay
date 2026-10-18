-- Ledger reconciliation run history.
--
-- Each row records one reconciliation pass per asset: the ledger liability
-- (what the ledger says EngiPay owes users) and the on-chain custody balance
-- (what the chain actually holds). The difference should always be >= 0; a
-- negative difference means the chain holds less than the ledger says it owes,
-- which requires immediate operator review.

CREATE TABLE reconciliation_runs (
    id              BIGSERIAL PRIMARY KEY,
    ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    asset           TEXT NOT NULL,
    ledger_liability    NUMERIC(78, 0) NOT NULL,
    custody_balance     NUMERIC(78, 0) NOT NULL,
    -- custody_balance - ledger_liability; negative = shortfall
    discrepancy         NUMERIC(78, 0) NOT NULL GENERATED ALWAYS AS (custody_balance - ledger_liability) STORED
);

CREATE INDEX reconciliation_runs_by_asset_time ON reconciliation_runs (asset, ran_at DESC);
