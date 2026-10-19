-- Migration 0021: several wallets per account.
--
-- Before this, users.wallet_address held one wallet, and signing in with a
-- second wallet created a second account. user_wallets lets one account hold
-- many wallets. users.wallet_address stays the account's first wallet.
--
-- (chain, address) is UNIQUE, so one wallet can belong to at most one account.
-- Attaching a wallet that is already linked anywhere is refused rather than
-- silently moved.
--
-- Unlinking schedules the removal: removal_effective_at is set to a time in
-- the future (see UNLINK_COOLDOWN in routes/wallets.rs). The wallet stays
-- usable until then, so a mistaken unlink can be noticed. Once the time has
-- passed the wallet no longer signs in.

CREATE TABLE IF NOT EXISTS user_wallets (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID        NOT NULL REFERENCES users (id),
    chain                 TEXT        NOT NULL CHECK (chain IN ('evm', 'stellar')),
    -- Lowercase 0x... for EVM; the G... account id for Stellar.
    address               TEXT        NOT NULL CHECK (char_length(address) BETWEEN 1 AND 128),
    linked_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    removal_effective_at  TIMESTAMPTZ,
    UNIQUE (chain, address)
);

CREATE INDEX IF NOT EXISTS user_wallets_user_idx ON user_wallets (user_id);
