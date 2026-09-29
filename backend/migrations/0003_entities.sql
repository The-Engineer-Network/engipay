-- User profiles schema: identity attributes and KYC tier.
--
-- Separates identity and profile information from the core users table,
-- allowing users to have unique handles/tags, email, phone, and KYC tier.
-- Case-insensitive unique constraint on tag ensures @alice and @Alice cannot coexist.

CREATE TABLE user_profiles (
    user_id         UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    tag             TEXT UNIQUE CHECK (length(btrim(tag)) > 0),
    email           TEXT,
    phone           TEXT,
    kyc_tier        INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive unique index on tag using LOWER(btrim(tag)) to prevent
-- handle collisions like @alice and @Alice.
CREATE UNIQUE INDEX user_profiles_tag_lower ON user_profiles (LOWER(btrim(tag)))
    WHERE tag IS NOT NULL;

-- Index for querying profiles by tag (used in lookups)
CREATE INDEX user_profiles_tag ON user_profiles (tag);

-- Index for querying by KYC tier (used for compliance/verification queries)
CREATE INDEX user_profiles_kyc_tier ON user_profiles (kyc_tier);

-- Index for querying by email (used for lookups and duplicate prevention)
CREATE INDEX user_profiles_email ON user_profiles (email) WHERE email IS NOT NULL;

-- Index for querying by phone (used for lookups and duplicate prevention)
CREATE INDEX user_profiles_phone ON user_profiles (phone) WHERE phone IS NOT NULL;

-- Index for querying profiles by creation date
CREATE INDEX user_profiles_created_at ON user_profiles (created_at);
