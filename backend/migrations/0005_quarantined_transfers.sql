-- Table to record Stellar transfers that were rejected for compliance or security reasons.
--
-- These transfers arrived at the custody account but were not credited to the ledger
-- because they failed validation (e.g., unsupported assets, unauthorized issuers).
-- Each row is a record for manual review.

CREATE TABLE quarantined_transfers (
    id              BIGSERIAL PRIMARY KEY,
    -- Reference as stored in the ledger: "stellar:<transaction_hash>:<operation_index>"
    reference       TEXT NOT NULL UNIQUE,
    -- Transaction hash on the Stellar network
    transaction_hash TEXT NOT NULL,
    -- Operation index (paging token from Horizon)
    operation_index  TEXT NOT NULL,
    -- Reason for rejection: 'unsupported_asset', 'failed_transaction', 'malformed', etc.
    reason          TEXT NOT NULL,
    -- Asset code (e.g. "USDC", "XLM") if available
    asset_code      TEXT,
    -- Asset issuer account if available
    asset_issuer    TEXT,
    -- Amount in stroops or XLM as received
    amount          TEXT,
    -- Source account that sent the payment
    from_account    TEXT NOT NULL,
    -- Destination muxed address
    to_muxed        TEXT,
    -- Ledger in which the transaction was confirmed
    ledger          BIGINT,
    -- Full Horizon JSON for manual review
    horizon_record  JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX quarantined_transfers_by_reference ON quarantined_transfers (reference);
CREATE INDEX quarantined_transfers_by_reason ON quarantined_transfers (reason);
CREATE INDEX quarantined_transfers_by_asset ON quarantined_transfers (asset_code, asset_issuer);
CREATE INDEX quarantined_transfers_by_created_at ON quarantined_transfers (created_at DESC);
