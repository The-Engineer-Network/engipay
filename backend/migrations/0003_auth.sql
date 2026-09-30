-- User profiles and authentication.

CREATE TABLE user_profiles (
    id              UUID PRIMARY KEY REFERENCES users (id),
    tier            INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure each user has exactly one profile.
CREATE UNIQUE INDEX user_profiles_one_per_user ON user_profiles (id);
