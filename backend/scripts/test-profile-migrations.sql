-- Run after all migrations; roll back the fixtures so this leaves no data.
BEGIN;
DO $$
DECLARE
    profile_id UUID := 'aaaaaaaa-bbbb-cccc-dddd-000000000001';
    other_id UUID := 'aaaaaaaa-bbbb-cccc-dddd-000000000002';
BEGIN
    INSERT INTO users (id) VALUES (profile_id), (other_id);
    INSERT INTO user_profiles (id) VALUES (profile_id), (other_id);

    IF (SELECT tier FROM user_profiles WHERE id = profile_id) <> 0 THEN
        RAISE EXCEPTION 'authentication profile default tier changed';
    END IF;
    UPDATE user_profiles SET tag = 'Alice', email = 'alice@example.test', tier = 1
        WHERE id = profile_id;
    IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = profile_id
                   AND tag = 'Alice' AND email = 'alice@example.test' AND tier = 1) THEN
        RAISE EXCEPTION 'profile update did not persist';
    END IF;

    BEGIN
        UPDATE user_profiles SET tag = ' alice ' WHERE id = other_id;
        RAISE EXCEPTION 'case-insensitive tag uniqueness was not enforced';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        UPDATE user_profiles SET id = other_id WHERE id = profile_id;
        RAISE EXCEPTION 'profile identity update was accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'user_profile id is immutable:%' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        UPDATE user_profiles SET created_at = created_at + INTERVAL '1 second'
            WHERE id = profile_id;
        RAISE EXCEPTION 'profile creation timestamp update was accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM NOT LIKE 'user_profile created_at is immutable:%' THEN
            RAISE;
        END IF;
    END;
END;
$$;
ROLLBACK;
