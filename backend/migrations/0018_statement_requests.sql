-- Monthly statement export requests.
--
-- When a user requests a statement for a large month we generate it in the
-- background and record the job here so the client can poll for completion
-- and download the result.  For small months the endpoint returns the data
-- inline and no row is written.

CREATE TABLE statement_requests (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users (id),
    -- The month being reported, stored as the first day of that month.
    period_start DATE NOT NULL,
    format      TEXT NOT NULL CHECK (format IN ('json', 'csv', 'pdf')),
    status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
    -- When status = 'ready', this holds the generated content (CSV text or
    -- the base64-encoded PDF bytes).  NULL until the job finishes.
    content     TEXT,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX statement_requests_by_user ON statement_requests (user_id, period_start DESC);

-- Keep updated_at current automatically.
CREATE FUNCTION statement_requests_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER statement_requests_set_updated_at
    BEFORE UPDATE ON statement_requests
    FOR EACH ROW EXECUTE FUNCTION statement_requests_updated_at();
