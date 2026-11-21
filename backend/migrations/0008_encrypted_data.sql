-- EngiPay Encrypted Data Migration (Issue #498)
-- Encrypts sensitive personal data at rest with envelope encryption and key rotation support
--
-- This migration:
-- 1. Creates kyc_records table if not exists
-- 2. Adds encrypted columns to existing tables
-- 3. Creates key management table for master key and data key metadata
-- 4. Adds searchable keyed hash columns for lookup-friendly queries

-- Create kyc_records table
CREATE TABLE IF NOT EXISTS kyc_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id),
    provider        TEXT NOT NULL,
    level           TEXT NOT NULL CHECK (level IN ('tier_0', 'tier_1', 'tier_2', 'tier_3')),
    status          TEXT NOT NULL CHECK (status IN ('pending', 'verified', 'failed')),
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (user_id, provider)
);

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_kyc_records_user_id ON kyc_records (user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_records_status ON kyc_records (status);

-- Add encrypted phone column to user_profiles (stores the encrypted blob)
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS phone_encrypted BYTEA,
    ADD COLUMN IF NOT EXISTS phone_hash BYTEA,  -- Searchable keyed hash
    ADD COLUMN IF NOT EXISTS phone_key_id UUID;  -- Reference to data key used

-- Add encrypted account number column to bank_accounts
ALTER TABLE bank_accounts
    ADD COLUMN IF NOT EXISTS account_number_encrypted BYTEA,
    ADD COLUMN IF NOT EXISTS account_number_hash BYTEA,  -- Searchable keyed hash
    ADD COLUMN IF NOT EXISTS account_number_key_id UUID;  -- Reference to data key used

-- Create key management table for master key and data key metadata
CREATE TABLE IF NOT EXISTS encryption_keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_id              TEXT NOT NULL UNIQUE,       -- External key identifier (e.g., "master-2024")
    key_version         INTEGER NOT NULL,           -- Version number for rotation
    key_data            BYTEA NOT NULL,             -- The actual key material (wrapped/encrypted)
    key_algorithm       TEXT NOT NULL DEFAULT 'aes-256-gcm',
    is_active           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    rotated_at          TIMESTAMPTZ,
    rotation_count      INTEGER NOT NULL DEFAULT 0
);

-- Insert initial master key (key_id = 'master-current', will be set via environment)
-- The actual key material should be provided through environment variable MASTER_KEY_BASE64
-- and wrapped/encrypted stored here. For now, we add a placeholder row.
INSERT INTO encryption_keys (key_id, key_version, key_algorithm, is_active, key_data)
    VALUES ('master-current', 1, 'aes-256-gcm', TRUE, NULL)
    ON CONFLICT (key_id) DO NOTHING;

-- Create index for active key lookups
CREATE INDEX IF NOT EXISTS idx_encryption_keys_active ON encryption_keys (is_active, key_version);

-- Comments to document the encryption strategy
COMMENT ON COLUMN user_profiles.phone_encrypted IS 'Encrypted phone number using envelope encryption';
COMMENT ON COLUMN user_profiles.phone_hash IS 'Searchable keyed HMAC-SHA256 hash for lookups';
COMMENT ON COLUMN user_profiles.phone_key_id IS 'UUID referencing the encryption key version used';
COMMENT ON COLUMN bank_accounts.account_number_encrypted IS 'Encrypted bank account number using envelope encryption';
COMMENT ON COLUMN bank_accounts.account_number_hash IS 'Searchable keyed HMAC-SHA256 hash for lookups';
COMMENT ON COLUMN bank_accounts.account_number_key_id IS 'UUID referencing the encryption key version used';
COMMENT ON COLUMN kyc_records.provider IS 'KYC provider name (not encrypted, public identifier)';
COMMENT ON COLUMN kyc_records.level IS 'KYC verification level (not encrypted, public identifier)';
COMMENT ON COLUMN kyc_records.status IS 'KYC verification status (not encrypted, public identifier)';

-- Note: The actual encryption/decryption logic will be implemented in the Rust backend
-- using envelope encryption: data keys encrypt individual records, master key wraps data keys
-- Key rotation: re-wrap data keys with new master key without re-encrypting the data itself