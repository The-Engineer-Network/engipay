-- 0020_user_contacts.sql
-- Saved contacts (tags or chain addresses with a label) per user (#484).

CREATE TABLE IF NOT EXISTS user_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('tag', 'address')),
    value TEXT NOT NULL,
    chain TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_contacts_user_kind_value_key UNIQUE (user_id, kind, value)
);

CREATE INDEX IF NOT EXISTS user_contacts_user_id_idx ON user_contacts (user_id);