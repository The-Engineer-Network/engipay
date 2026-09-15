-- EngiPay ledger schema.
--
-- The database enforces the same rules as engipay-ledger, so a bug in the
-- application cannot write a corrupt ledger:
--   * ledger rows are append-only: UPDATE and DELETE are refused
--   * every transaction balances to zero per asset, checked at COMMIT
--   * a user's balance cannot go negative, checked at COMMIT
-- Amounts are whole smallest units (wei, USDC units, sats) as NUMERIC(78,0),
-- wide enough for any uint256 and never rounded.

CREATE TABLE users (
    id              UUID PRIMARY KEY,
    wallet_address  TEXT UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_transactions (
    id          UUID PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('deposit', 'transfer', 'hold', 'release_hold', 'settle_hold')),
    -- The caller's idempotency key. UNIQUE is what makes a retried request safe.
    reference   TEXT NOT NULL UNIQUE CHECK (length(btrim(reference)) > 0),
    -- Fingerprint of the original request, compared when a reference is reused.
    request     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ledger_postings (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  UUID NOT NULL REFERENCES ledger_transactions (id),
    owner_kind      TEXT NOT NULL CHECK (owner_kind IN ('user', 'system')),
    user_id         UUID REFERENCES users (id),
    system_account  TEXT CHECK (system_account IN ('external_inflow', 'external_outflow', 'fees')),
    asset           TEXT NOT NULL CHECK (asset IN ('ETH', 'USDC', 'BTC')),
    bucket          TEXT NOT NULL CHECK (bucket IN ('available', 'held')),
    amount          NUMERIC(78, 0) NOT NULL CHECK (amount <> 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (owner_kind = 'user' AND user_id IS NOT NULL AND system_account IS NULL)
        OR (owner_kind = 'system' AND user_id IS NULL AND system_account IS NOT NULL AND bucket = 'available')
    )
);

CREATE INDEX ledger_postings_by_transaction ON ledger_postings (transaction_id);
CREATE INDEX ledger_postings_by_user_asset ON ledger_postings (user_id, asset, bucket) WHERE owner_kind = 'user';

CREATE TABLE ledger_holds (
    reference   TEXT PRIMARY KEY REFERENCES ledger_transactions (reference),
    user_id     UUID NOT NULL REFERENCES users (id),
    asset       TEXT NOT NULL CHECK (asset IN ('ETH', 'USDC', 'BTC')),
    amount      NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    state       TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'released', 'settled')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at   TIMESTAMPTZ,
    CHECK ((state = 'open') = (closed_at IS NULL))
);

-- Balances are derived from postings, never stored separately, so they cannot
-- drift from the history.
CREATE VIEW account_balances AS
SELECT owner_kind, user_id, system_account, asset, bucket, SUM(amount) AS amount
FROM ledger_postings
GROUP BY owner_kind, user_id, system_account, asset, bucket;

-- Append-only ledger.
CREATE FUNCTION ledger_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'the ledger is append-only: % on % is not allowed', TG_OP, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER ledger_transactions_append_only
    BEFORE UPDATE OR DELETE ON ledger_transactions
    FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledger_postings_append_only
    BEFORE UPDATE OR DELETE ON ledger_postings
    FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- A hold may change state exactly once, from open to closed, and nothing else
-- about it may change.
CREATE FUNCTION ledger_hold_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'holds cannot be deleted';
    END IF;
    IF OLD.state <> 'open' THEN
        RAISE EXCEPTION 'hold % is already %', OLD.reference, OLD.state;
    END IF;
    IF NEW.reference <> OLD.reference OR NEW.user_id <> OLD.user_id
       OR NEW.asset <> OLD.asset OR NEW.amount <> OLD.amount THEN
        RAISE EXCEPTION 'only the state of a hold may change';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_holds_transition
    BEFORE UPDATE OR DELETE ON ledger_holds
    FOR EACH ROW EXECUTE FUNCTION ledger_hold_transition();

-- Checked at COMMIT, after all of a transaction's postings exist.
CREATE FUNCTION ledger_check_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    unbalanced_asset TEXT;
    negative_owner   UUID;
BEGIN
    SELECT asset INTO unbalanced_asset
    FROM ledger_postings
    WHERE transaction_id = NEW.transaction_id
    GROUP BY asset
    HAVING SUM(amount) <> 0
    LIMIT 1;

    IF unbalanced_asset IS NOT NULL THEN
        RAISE EXCEPTION 'transaction % does not balance for %', NEW.transaction_id, unbalanced_asset;
    END IF;

    SELECT b.user_id INTO negative_owner
    FROM account_balances b
    WHERE b.owner_kind = 'user'
      AND b.user_id IN (SELECT user_id FROM ledger_postings WHERE transaction_id = NEW.transaction_id AND owner_kind = 'user')
      AND b.amount < 0
    LIMIT 1;

    IF negative_owner IS NOT NULL THEN
        RAISE EXCEPTION 'transaction % would make user % negative', NEW.transaction_id, negative_owner;
    END IF;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_postings_balanced
    AFTER INSERT ON ledger_postings
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ledger_check_transaction();
