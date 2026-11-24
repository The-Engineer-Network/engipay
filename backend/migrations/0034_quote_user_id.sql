-- Add user_id to quotes table to tie quotes to authenticated users (#619).

ALTER TABLE quotes
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users (id);

CREATE INDEX IF NOT EXISTS quotes_user_id_idx ON quotes (user_id);
