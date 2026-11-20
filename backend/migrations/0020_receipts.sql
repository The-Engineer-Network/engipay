-- 0020_receipts.sql
-- Signed, verifiable transaction receipts (#478)
--
-- Stores issued receipts (transfers, withdrawals, orders) signed with a
-- server-held Ed25519 key, plus the metadata for every signing key so that
-- receipts issued under a rotated-out key remain verifiable.

BEGIN;

-- Signing key metadata. Rows are never deleted so that old receipts can
-- always be verified against the key that signed them.
CREATE TABLE IF NOT EXISTS receipt_signing_keys (
    key_id      text PRIMARY KEY,
    public_key  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    retired_at  timestamptz
);

-- Issued receipts. `canonical_payload` holds the exact bytes that were
-- signed (as JSONB for queryability); `signature` holds the Ed25519
-- signature over the canonical serialization of that payload.
CREATE TABLE IF NOT EXISTS receipts (
    receipt_id       uuid PRIMARY KEY,
    receipt_type     text NOT NULL,
    ledger_reference text NOT NULL,
    user_id          uuid NOT NULL,
    canonical_payload jsonb NOT NULL,
    key_id           text NOT NULL REFERENCES receipt_signing_keys (key_id),
    signature        bytea NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipts_user_id_idx
    ON receipts (user_id);

CREATE INDEX IF NOT EXISTS receipts_ledger_reference_idx
    ON receipts (ledger_reference);

COMMIT;