BEGIN;
DO $$
DECLARE
    alice UUID := 'cccccccc-0000-0000-0000-000000000001';
    bob UUID := 'cccccccc-0000-0000-0000-000000000002';
BEGIN
    INSERT INTO users(id) VALUES (alice), (bob);
    -- Both users may use the configured shared Base custody address.
    INSERT INTO deposit_addresses(user_id, chain, address)
        VALUES (alice, 'base', 'shared-base'), (bob, 'base', 'shared-base');
    BEGIN
        INSERT INTO deposit_addresses(user_id, chain, address) VALUES (alice, 'base', 'another');
        RAISE EXCEPTION 'duplicate user and chain accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    INSERT INTO deposit_addresses(user_id, chain, address, muxed_id)
        VALUES (alice, 'stellar', 'muxed-alice', 42);
    BEGIN
        INSERT INTO deposit_addresses(user_id, chain, address, muxed_id)
            VALUES (bob, 'stellar', 'muxed-bob', 42);
        RAISE EXCEPTION 'duplicate muxed id accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    INSERT INTO chain_cursors(chain, cursor) VALUES ('stellar', '123');
    INSERT INTO uncredited_deposits(reason, raw_payload) VALUES ('unknown_recipient', '{}');
    INSERT INTO payment_requests(id, user_id, asset, amount, uri, expires_at)
        VALUES (alice, alice, 'XLM', 123456789012345678901234567890, 'engipay:test', now() + interval '1 hour');
    IF NOT EXISTS (SELECT 1 FROM payment_requests WHERE id = alice AND status = 'pending'
                   AND amount = 123456789012345678901234567890) THEN
        RAISE EXCEPTION 'invoice amount or status changed';
    END IF;
    UPDATE payment_requests SET status = 'paid', settled_at = now() WHERE id = alice;
END;
$$;
ROLLBACK;
