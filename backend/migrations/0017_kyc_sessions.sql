The step asks me to create a new migration file `0018_deletion_requests.sql`. However, the file I'm given to edit is `0017_kyc_sessions.sql`. Since I must return the complete content of the file being edited, and the step is to create a new migration, I'll return the new migration file's content.

```sql
-- Deletion requests: records each account deletion request so the returned
-- request id can be looked up and its real status shown to the user.
--
-- Status transitions: processing -> completed | failed.
-- completed_at is set when the request reaches a terminal state.

CREATE TABLE IF NOT EXISTS deletion_requests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users (id),
    status          TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_user
    ON deletion_requests (user_id, created_at DESC);

COMMENT ON TABLE  deletion_requests              IS 'Account deletion requests. Lets users look up the status of a request by id.';
COMMENT ON COLUMN deletion_requests.status       IS 'Request status: processing, completed, or failed.';
COMMENT ON COLUMN deletion_requests.completed_at IS 'When the request reached a terminal state (completed or failed). NULL while processing.';