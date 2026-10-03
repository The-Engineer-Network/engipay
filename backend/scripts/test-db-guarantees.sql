-- Proves the database refuses to corrupt the ledger, even if the application
-- tries to. Run against a throwaway database with migrations applied:
--
--   psql -v ON_ERROR_STOP=0 -f scripts/test-db-guarantees.sql
--
-- Each "EXPECT" block is followed by the error Postgres must raise. The runner
-- script counts them; any block that succeeds when it should fail is a bug.

\set user1 '11111111-1111-1111-1111-111111111111'
\set user2 '22222222-2222-2222-2222-222222222222'

INSERT INTO users (id) VALUES (:'user1'), (:'user2');

\echo === CASE 1: a balanced deposit commits (EXPECT OK)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'deposit', 'dep-1', 'deposit');
INSERT INTO ledger_postings (transaction_id, owner_kind, system_account, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'system', 'external_inflow', 'USDC', 'available', -100);
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'user', :'user1', 'USDC', 'available', 100);
COMMIT;
SELECT 'CASE1_RESULT balance=' || amount FROM account_balances
    WHERE user_id = :'user1' AND asset = 'USDC' AND bucket = 'available';

\echo === CASE 2: an unbalanced transaction is refused at COMMIT (EXPECT ERROR does not balance)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'deposit', 'dep-2', 'deposit');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'user', :'user1', 'USDC', 'available', 500);
COMMIT;

\echo === CASE 3: a transfer that would make a user negative is refused (EXPECT ERROR negative)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'transfer', 'pay-1', 'transfer');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'user', :'user1', 'USDC', 'available', -150);
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000003', 'user', :'user2', 'USDC', 'available', 150);
COMMIT;

\echo === CASE 4: editing a posting is refused (EXPECT ERROR append-only)
UPDATE ledger_postings SET amount = 1000000 WHERE user_id = :'user1';

\echo === CASE 5: deleting a posting is refused (EXPECT ERROR append-only)
DELETE FROM ledger_postings WHERE user_id = :'user1';

\echo === CASE 6: deleting a transaction is refused (EXPECT ERROR append-only)
DELETE FROM ledger_transactions WHERE reference = 'dep-1';

\echo === CASE 7: reusing a reference is refused (EXPECT ERROR duplicate key)
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000007', 'deposit', 'dep-1', 'deposit');

\echo === CASE 8: a zero-amount posting is refused (EXPECT ERROR check constraint)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000008', 'deposit', 'dep-8', 'deposit');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000008', 'user', :'user1', 'USDC', 'available', 0);
COMMIT;

\echo === CASE 9: an unknown asset is refused (EXPECT ERROR check constraint)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000009', 'deposit', 'dep-9', 'deposit');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000009', 'user', :'user1', 'DOGE', 'available', 5);
COMMIT;

\echo === CASE 10: a closed hold cannot be reopened (EXPECT ERROR already)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000010', 'hold', 'wd-1', 'hold');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000010', 'user', :'user1', 'USDC', 'available', -40),
           ('aaaaaaaa-0000-0000-0000-000000000010', 'user', :'user1', 'USDC', 'held', 40);
INSERT INTO ledger_holds (reference, user_id, asset, amount) VALUES ('wd-1', :'user1', 'USDC', 40);
COMMIT;
UPDATE ledger_holds SET state = 'settled', closed_at = now() WHERE reference = 'wd-1';
UPDATE ledger_holds SET state = 'open', closed_at = NULL WHERE reference = 'wd-1';

-- deposit_addresses guarantees

\echo === CASE 11: a valid deposit address inserts (EXPECT OK)
INSERT INTO deposit_addresses (id, user_id, chain, address, muxed_id, derivation_index)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000011', :'user1', 'stellar', 'GAAAA...AAA', 1, 0);
SELECT 'CASE11_RESULT chain=' || chain FROM deposit_addresses WHERE id = 'bbbbbbbb-0000-0000-0000-000000000011';

\echo === CASE 12: duplicate address is refused (EXPECT ERROR duplicate key)
INSERT INTO deposit_addresses (id, user_id, chain, address, derivation_index)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000012', :'user2', 'base', 'GAAAA...AAA', 1);

\echo === CASE 13: duplicate user+chain is refused (EXPECT ERROR duplicate key)
INSERT INTO deposit_addresses (id, user_id, chain, address, derivation_index)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000013', :'user1', 'stellar', 'GBBBB...BBB', 1);

\echo === CASE 14: invalid chain is refused (EXPECT ERROR check constraint)
INSERT INTO deposit_addresses (id, user_id, chain, address, derivation_index)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000014', :'user1', 'solana', 'GCCCC...CCC', 2);

-- bank_accounts guarantees

\echo === CASE 15: a valid bank account inserts (EXPECT OK)
INSERT INTO bank_accounts (id, user_id, bank_code, account_number, account_name, verified)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000015', :'user1', '044', '1234567890', 'John Doe', true);
SELECT 'CASE15_RESULT verified=' || verified FROM bank_accounts WHERE id = 'bbbbbbbb-0000-0000-0000-000000000015';

\echo === CASE 16: duplicate user+bank+account is refused (EXPECT ERROR duplicate key)
INSERT INTO bank_accounts (id, user_id, bank_code, account_number, account_name)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000016', :'user1', '044', '1234567890', 'John Doe');

-- conversions guarantees

\echo === CASE 17: a valid conversion inserts (EXPECT OK)
INSERT INTO conversions (id, user_id, asset_in, asset_out, amount_in, amount_out, rate, fee, route, status, expires_at)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000017', :'user1', 'USDC', 'ETH', 1000000, 500000000000000, 0.0005, 1000, 'uniswap', 'quoted', now() + interval '10 minutes');
SELECT 'CASE17_RESULT status=' || status FROM conversions WHERE id = 'bbbbbbbb-0000-0000-0000-000000000017';

\echo === CASE 18: invalid conversion status is refused (EXPECT ERROR check constraint)
INSERT INTO conversions (id, user_id, asset_in, asset_out, amount_in, amount_out, rate, fee, route, status, expires_at)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000018', :'user1', 'USDC', 'ETH', 1000000, 500000000000000, 0.0005, 1000, 'uniswap', 'pending', now() + interval '10 minutes');

-- ramp_orders guarantees

\echo === CASE 19: a valid ramp order inserts (EXPECT OK)
INSERT INTO ramp_orders (id, user_id, direction, asset, crypto_amount, ngn_amount, rate, fee, partner, partner_ref, status)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000019', :'user1', 'on_ramp', 'USDC', 1000000, 1500000000, 1500.00, 5000, 'paystack', 'PS-001', 'quoted');
SELECT 'CASE19_RESULT direction=' || direction FROM ramp_orders WHERE id = 'bbbbbbbb-0000-0000-0000-000000000019';

\echo === CASE 20: invalid ramp direction is refused (EXPECT ERROR check constraint)
INSERT INTO ramp_orders (id, user_id, direction, asset, crypto_amount, ngn_amount, rate, fee, partner, partner_ref, status)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000020', :'user1', 'swap', 'USDC', 1000000, 1500000000, 1500.00, 5000, 'paystack', 'PS-002', 'quoted');

\echo === CASE 21: duplicate partner_ref is refused (EXPECT ERROR duplicate key)
INSERT INTO ramp_orders (id, user_id, direction, asset, crypto_amount, ngn_amount, rate, fee, partner, partner_ref, status)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000021', :'user2', 'off_ramp', 'USDC', 500000, 750000000, 1500.00, 2500, 'paystack', 'PS-001', 'quoted');

\echo === CASE 22: invalid ramp status is refused (EXPECT ERROR check constraint)
INSERT INTO ramp_orders (id, user_id, direction, asset, crypto_amount, ngn_amount, rate, fee, partner, partner_ref, status)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000022', :'user1', 'on_ramp', 'BTC', 100000, 150000000, 1500.00, 500, 'flutterwave', 'FW-001', 'pending');

\echo === FINAL: history intact after every refused attempt
SELECT 'FINAL_RESULT available=' || coalesce(sum(amount) FILTER (WHERE bucket = 'available'), 0)
       || ' held=' || coalesce(sum(amount) FILTER (WHERE bucket = 'held'), 0)
       || ' transactions=' || (SELECT count(*) FROM ledger_transactions)
FROM ledger_postings WHERE user_id = :'user1';
