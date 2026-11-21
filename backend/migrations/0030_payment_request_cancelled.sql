-- Allow the creator to cancel an open payment request.
ALTER TABLE payment_requests DROP CONSTRAINT IF EXISTS payment_requests_status_check;
ALTER TABLE payment_requests
    ADD CONSTRAINT payment_requests_status_check
    CHECK (status IN ('pending', 'partially_paid', 'paid', 'expired', 'cancelled'));
