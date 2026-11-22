-- Optional sender note on EngiPay-to-EngiPay transfers (#696).
ALTER TABLE ledger_transactions
    ADD COLUMN note TEXT CHECK (note IS NULL OR char_length(note) <= 140);
