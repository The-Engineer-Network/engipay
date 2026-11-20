-- Allow the requester to cancel a pending money request (#695).
ALTER TABLE p2p_money_requests
    DROP CONSTRAINT IF EXISTS p2p_money_requests_status_check;
ALTER TABLE p2p_money_requests
    ADD CONSTRAINT p2p_money_requests_status_check
    CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled'));
