-- 0021_freeze.sql
-- Freeze accounts for security (#490)

BEGIN;

-- Add freeze fields to user_profiles
ALTER TABLE user_profiles
    ADD COLUMN     frozen         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN     frozen_reason  TEXT,
    ADD COLUMN     frozen_by      UUID REFERENCES users (id);

-- Create index for efficient freeze lookups
CREATE INDEX idx_user_profiles_frozen ON user_profiles (frozen) WHERE frozen = true;

-- Comment on columns
COMMENT ON COLUMN user_profiles.frozen IS 'When true, the account is frozen and cannot move funds';
COMMENT ON COLUMN user_profiles.frozen_reason IS 'Reason for the freeze';
COMMENT ON COLUMN user_profiles.frozen_by IS 'User ID of the actor who initiated the freeze';

COMMIT;
