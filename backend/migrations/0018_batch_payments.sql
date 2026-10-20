-- Batch payment support for CSV uploads (Issue #512)
--
-- Allows businesses to upload a CSV of recipients and amounts, validate all
-- rows before execution, require approval above thresholds, and execute
-- idempotently so re-running never pays twice.

CREATE TYPE batch_status AS ENUM (
    'pending',
    'awaiting_approval',
    'processing',
    'completed',
    'cancelled'
);

CREATE TYPE row_status AS ENUM (
    'pending',
    'success',
    'failed'
);

CREATE TABLE batch_payments (
    batch_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    status batch_status NOT NULL DEFAULT 'pending',
    total_rows INTEGER NOT NULL CHECK (total_rows > 0),
    processed_rows INTEGER NOT NULL DEFAULT 0 CHECK (processed_rows >= 0 AND processed_rows <= total_rows),
    successful INTEGER NOT NULL DEFAULT 0 CHECK (successful >= 0),
    failed INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Ensure approver is different from creator when approval is required
    CHECK (NOT requires_approval OR approved_by IS NULL OR approved_by != user_id),
    
    -- Approval timestamp must be set if approved_by is set
    CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE TABLE batch_payment_rows (
    row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID NOT NULL REFERENCES batch_payments(batch_id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL CHECK (row_number > 0),
    destination TEXT NOT NULL,
    asset TEXT NOT NULL,
    amount TEXT NOT NULL,
    memo TEXT,
    status row_status NOT NULL DEFAULT 'pending',
    tx_hash TEXT,
    error TEXT,
    -- Idempotency: tx_hash for the withdrawal or transfer that executed this row
    withdrawal_id UUID REFERENCES withdrawals(id),
    transfer_id UUID REFERENCES ledger_transactions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each row in a batch must be unique by row number
    UNIQUE (batch_id, row_number),
    
    -- Success rows must have either a tx_hash or a transfer_id
    CHECK (status != 'success' OR tx_hash IS NOT NULL OR transfer_id IS NOT NULL),
    
    -- Failed rows must have an error message
    CHECK (status != 'failed' OR error IS NOT NULL),
    
    -- Idempotency: can't have both withdrawal and transfer
    CHECK ((withdrawal_id IS NULL) OR (transfer_id IS NULL))
);

-- Index for querying batches by user
CREATE INDEX idx_batch_payments_user ON batch_payments(user_id, created_at DESC);

-- Index for querying batches by status (for worker processing)
CREATE INDEX idx_batch_payments_status ON batch_payments(status, created_at);

-- Index for querying rows by batch
CREATE INDEX idx_batch_payment_rows_batch ON batch_payment_rows(batch_id, row_number);

-- Index for finding pending rows to process
CREATE INDEX idx_batch_payment_rows_pending ON batch_payment_rows(batch_id, status) 
WHERE status = 'pending';

-- Trigger to update updated_at on batch_payments
CREATE TRIGGER update_batch_payments_updated_at
    BEFORE UPDATE ON batch_payments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Trigger to update updated_at on batch_payment_rows
CREATE TRIGGER update_batch_payment_rows_updated_at
    BEFORE UPDATE ON batch_payment_rows
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Function to update batch counters when row status changes
CREATE OR REPLACE FUNCTION update_batch_counters()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        UPDATE batch_payments
        SET 
            processed_rows = (
                SELECT COUNT(*) 
                FROM batch_payment_rows 
                WHERE batch_id = NEW.batch_id 
                AND status IN ('success', 'failed')
            ),
            successful = (
                SELECT COUNT(*) 
                FROM batch_payment_rows 
                WHERE batch_id = NEW.batch_id 
                AND status = 'success'
            ),
            failed = (
                SELECT COUNT(*) 
                FROM batch_payment_rows 
                WHERE batch_id = NEW.batch_id 
                AND status = 'failed'
            ),
            status = CASE
                WHEN (SELECT COUNT(*) FROM batch_payment_rows WHERE batch_id = NEW.batch_id AND status = 'pending') = 0
                THEN 'completed'::batch_status
                ELSE status
            END,
            updated_at = NOW()
        WHERE batch_id = NEW.batch_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_batch_counters_trigger
    AFTER UPDATE ON batch_payment_rows
    FOR EACH ROW
    EXECUTE FUNCTION update_batch_counters();

-- Grant necessary permissions
-- GRANT SELECT, INSERT, UPDATE ON batch_payments TO engipay_api;
-- GRANT SELECT, INSERT, UPDATE ON batch_payment_rows TO engipay_api;
-- GRANT USAGE ON SEQUENCE batch_payments_batch_id_seq TO engipay_api;
-- GRANT USAGE ON SEQUENCE batch_payment_rows_row_id_seq TO engipay_api;

COMMENT ON TABLE batch_payments IS 'CSV batch payment jobs uploaded by businesses';
COMMENT ON TABLE batch_payment_rows IS 'Individual payment rows within a batch, processed idempotently';
COMMENT ON COLUMN batch_payments.requires_approval IS 'True if total amount exceeds threshold';
COMMENT ON COLUMN batch_payment_rows.withdrawal_id IS 'Idempotency: the withdrawal that executed this row';
COMMENT ON COLUMN batch_payment_rows.transfer_id IS 'Idempotency: the internal transfer that executed this row';
