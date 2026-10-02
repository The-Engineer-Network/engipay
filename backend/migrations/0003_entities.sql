-- User profiles schema and indices (Epic 1: DB-03).
-- Creates user_profiles table with identity attributes and KYC tier.

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id     UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    tag         TEXT UNIQUE,
    email       TEXT,
    phone       TEXT,
    kyc_tier    INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique index on tag to prevent handle collisions.
-- Ensures @alice and @Alice cannot both exist.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_tag_lower
    ON user_profiles (LOWER(btrim(tag))) WHERE tag IS NOT NULL;

-- Index for efficient email lookups.
CREATE INDEX IF NOT EXISTS idx_user_profiles_email
    ON user_profiles (email) WHERE email IS NOT NULL;

-- Index for efficient phone lookups.
CREATE INDEX IF NOT EXISTS idx_user_profiles_phone
    ON user_profiles (phone) WHERE phone IS NOT NULL;

-- Index for KYC tier lookups and filtering.
CREATE INDEX IF NOT EXISTS idx_user_profiles_kyc_tier
    ON user_profiles (kyc_tier);
