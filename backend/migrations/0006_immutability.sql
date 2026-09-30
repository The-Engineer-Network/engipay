-- Immutability triggers and performance indices for EngiPay (Epic 1: DB-01 / DB-03 extensions).
-- Enforces identity immutability and adds high-throughput indices for postings
-- and deposit address lookups.

-- Immutability triggers for user identity attributes (Issue #68)
CREATE OR REPLACE FUNCTION user_immutable_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.id <> NEW.id THEN
            RAISE EXCEPTION 'user id is immutable: cannot change % to %', OLD.id, NEW.id;
        END IF;
        IF OLD.created_at <> NEW.created_at THEN
            RAISE EXCEPTION 'user created_at is immutable: cannot change % to %', OLD.created_at, NEW.created_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER users_immutable_fields
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION user_immutable_fields();

CREATE OR REPLACE FUNCTION user_profile_immutable_fields() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.id <> NEW.id THEN
            RAISE EXCEPTION 'user_profile id is immutable: cannot change % to %', OLD.id, NEW.id;
        END IF;
        IF OLD.created_at <> NEW.created_at THEN
            RAISE EXCEPTION 'user_profile created_at is immutable: cannot change % to %', OLD.created_at, NEW.created_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER user_profiles_immutable_fields
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION user_profile_immutable_fields();

-- High-throughput user postings queries indices (Issue #69)
CREATE INDEX IF NOT EXISTS idx_ledger_postings_user_created
    ON ledger_postings (user_id, created_at DESC)
    WHERE owner_kind = 'user';

CREATE INDEX IF NOT EXISTS idx_ledger_postings_ref
    ON ledger_postings (transaction_id);

-- Fast muxed account and deposit address resolution indices (Issue #70)
CREATE INDEX IF NOT EXISTS idx_deposit_addresses_muxed_id
    ON deposit_addresses (muxed_id)
    WHERE muxed_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deposit_addresses_address
    ON deposit_addresses (address);
