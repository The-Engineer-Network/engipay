-- Migration 0018: channel accounts for parallel Stellar withdrawals.
--
-- Every withdrawal previously used the custody account's sequence number,
-- serialising withdrawals and causing `tx_bad_seq` collisions under load.
-- Channel accounts are separate signing accounts whose only role is to be the
-- transaction *source* (which owns the sequence number). The custody account
-- is set as the payment operation's *source* so the funds still leave custody.
--
-- Because the channel account is the transaction source, its sequence number
-- is the one that must be managed. This table persists the last-used sequence
-- per channel account so the pool survives a restart without replaying or
-- skipping a sequence number, which would either duplicate or stall
-- withdrawals.
--
-- The pool is round-robin: each acquisition advances the sequence by one and
-- updates `last_sequence` atomically, so concurrent workers take disjoint
-- sequence numbers without coordinating through Horizon.

CREATE TABLE IF NOT EXISTS stellar_channel_accounts (
    -- The public key (G...) of the channel account.
    account             TEXT        PRIMARY KEY,
    -- The last sequence number used for a transaction sourced from this
    -- channel account. The next withdrawal uses `last_sequence + 1`.
    -- Starts at 0 before the first withdrawal; the pool refreshes from
    -- Horizon on startup and takes the maximum of (db, horizon) so a crash
    -- before the first commit never reuses a sequence.
    last_sequence       BIGINT      NOT NULL DEFAULT 0,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  stellar_channel_accounts            IS 'Channel accounts used as transaction sources for parallel Stellar withdrawals, with persistent sequence tracking.';
COMMENT ON COLUMN stellar_channel_accounts.account    IS 'The channel account public key (G...).';
COMMENT ON COLUMN stellar_channel_accounts.last_sequence IS 'The last sequence number consumed. Next withdrawal uses last_sequence + 1.';
