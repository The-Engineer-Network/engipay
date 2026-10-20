-- Anchor transaction tracking for SEP-24 deposits and withdrawals (Issue #514)
--
-- Tracks the state of deposits (fiat -> crypto) and withdrawals (crypto -> fiat)
-- through Stellar anchors using the SEP-24 interactive flow.

CREATE TYPE anchor_direction AS ENUM ('deposit', 'withdrawal');

CREATE TYPE anchor_status AS ENUM (
    'incomplete',
    'pending_user_transfer_start',
    'pending_anchor',
    'pending_stellar',
    'pending_external',
    'pending_user',
    'completed',
    'expired',
    'error'
);

CREATE TABLE anchor_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users (id),
    direction anchor_direction NOT NULL,
    
    -- Asset and amounts
    asset TEXT NOT NULL,
    amount_requested TEXT NOT NULL,
    amount_in TEXT,
    amount_out TEXT,
    amount_fee TEXT,
    
    -- SEP-24 details
    sep24_id TEXT NOT NULL UNIQUE,
    sep24_interactive_url TEXT NOT NULL,
    status anchor_status NOT NULL DEFAULT 'incomplete',
    status_message TEXT,
    
    -- Authentication
    jwt TEXT NOT NULL,
    jwt_expires_at TIMESTAMPTZ NOT NULL,
    
    -- Stellar transaction (when completed)
    stellar_tx_hash TEXT,
    
    -- External reference (bank transaction ID, etc.)
    external_tx_id TEXT,
    
    -- Ledger integration
    -- For deposits: the transfer that credited the ledger when anchor sent funds
    deposit_transfer_id UUID,
    -- For withdrawals: the withdrawal that debited the ledger when initiating
    withdrawal_id UUID REFERENCES withdrawals (id),
    
    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CHECK (direction = 'deposit' OR withdrawal_id IS NOT NULL),
    CHECK (direction = 'withdrawal' OR deposit_transfer_id IS NULL),
    CHECK (status != 'completed' OR completed_at IS NOT NULL),
    CHECK (status != 'completed' OR stellar_tx_hash IS NOT NULL)
);

-- Index for querying transactions by user
CREATE INDEX idx_anchor_transactions_user ON anchor_transactions(user_id, created_at DESC);

-- Index for querying by SEP-24 ID
CREATE INDEX idx_anchor_transactions_sep24 ON anchor_transactions(sep24_id);

-- Index for polling pending transactions (worker)
CREATE INDEX idx_anchor_transactions_pending ON anchor_transactions(status, updated_at)
WHERE status NOT IN ('completed', 'expired', 'error');

-- Index for finding transactions by ledger references
CREATE INDEX idx_anchor_transactions_deposit_transfer ON anchor_transactions(deposit_transfer_id)
WHERE deposit_transfer_id IS NOT NULL;

CREATE INDEX idx_anchor_transactions_withdrawal ON anchor_transactions(withdrawal_id)
WHERE withdrawal_id IS NOT NULL;

-- Trigger to update updated_at
CREATE TRIGGER update_anchor_transactions_updated_at
    BEFORE UPDATE ON anchor_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Grant necessary permissions
-- GRANT SELECT, INSERT, UPDATE ON anchor_transactions TO engipay_api;
-- GRANT USAGE ON SEQUENCE anchor_transactions_transaction_id_seq TO engipay_api;

COMMENT ON TABLE anchor_transactions IS 'SEP-24 anchor deposits and withdrawals (Naira on/off-ramp)';
COMMENT ON COLUMN anchor_transactions.sep24_id IS 'Transaction ID from the anchor (not our internal UUID)';
COMMENT ON COLUMN anchor_transactions.jwt IS 'SEP-10 JWT for authenticating with the anchor';
COMMENT ON COLUMN anchor_transactions.deposit_transfer_id IS 'Transfer that credited ledger when deposit completed';
COMMENT ON COLUMN anchor_transactions.withdrawal_id IS 'Withdrawal that debited ledger when initiating withdrawal';
