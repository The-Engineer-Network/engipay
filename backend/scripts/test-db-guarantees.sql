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

\echo === CASE 11: XLM deposit commits and balances correctly (EXPECT OK)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000011', 'deposit', 'xlm-dep-1', 'deposit');
INSERT INTO ledger_postings (transaction_id, owner_kind, system_account, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000011', 'system', 'external_inflow', 'XLM', 'available', -500);
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000011', 'user', :'user1', 'XLM', 'available', 500);
COMMIT;
SELECT 'CASE11_RESULT balance=' || amount FROM account_balances
    WHERE user_id = :'user1' AND asset = 'XLM' AND bucket = 'available';

\echo === CASE 12: XLM transfer between users balances (EXPECT OK)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000012', 'transfer', 'xlm-pay-1', 'transfer');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000012', 'user', :'user1', 'XLM', 'available', -200),
           ('aaaaaaaa-0000-0000-0000-000000000012', 'user', :'user2', 'XLM', 'available', 200);
COMMIT;
SELECT 'CASE12_RESULT user1=' || (SELECT amount FROM account_balances WHERE user_id = :'user1' AND asset = 'XLM' AND bucket = 'available')
       || ' user2=' || (SELECT amount FROM account_balances WHERE user_id = :'user2' AND asset = 'XLM' AND bucket = 'available');

\echo === CASE 13: XLM hold moves money to held bucket (EXPECT OK)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000013', 'hold', 'xlm-wd-1', 'hold');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000013', 'user', :'user1', 'XLM', 'available', -150),
           ('aaaaaaaa-0000-0000-0000-000000000013', 'user', :'user1', 'XLM', 'held', 150);
INSERT INTO ledger_holds (reference, user_id, asset, amount) VALUES ('xlm-wd-1', :'user1', 'XLM', 150);
COMMIT;
SELECT 'CASE13_RESULT available=' || (SELECT amount FROM account_balances WHERE user_id = :'user1' AND asset = 'XLM' AND bucket = 'available')
       || ' held=' || (SELECT amount FROM account_balances WHERE user_id = :'user1' AND asset = 'XLM' AND bucket = 'held');

\echo === CASE 14: XLM hold settlement moves money out and records fee (EXPECT OK)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000014', 'settle_hold', 'xlm-wd-1:settle', 'settle');
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000014', 'user', :'user1', 'XLM', 'held', -150);
INSERT INTO ledger_postings (transaction_id, owner_kind, system_account, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000014', 'system', 'external_outflow', 'XLM', 'available', 135);
INSERT INTO ledger_postings (transaction_id, owner_kind, system_account, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000014', 'system', 'fees', 'XLM', 'available', 15);
UPDATE ledger_holds SET state = 'settled', closed_at = now() WHERE reference = 'xlm-wd-1';
COMMIT;
SELECT 'CASE14_RESULT user1_held=' || coalesce((SELECT amount FROM account_balances WHERE user_id = :'user1' AND asset = 'XLM' AND bucket = 'held'), 0)
       || ' outflow=' || (SELECT amount FROM account_balances WHERE owner_kind = 'system' AND system_account = 'external_outflow' AND asset = 'XLM')
       || ' fees=' || (SELECT amount FROM account_balances WHERE owner_kind = 'system' AND system_account = 'fees' AND asset = 'XLM');

\echo === CASE 15: XLM unbalanced transaction refused (EXPECT ERROR does not balance for XLM)
BEGIN;
INSERT INTO ledger_transactions (id, kind, reference, request)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000015', 'deposit', 'xlm-dep-bad', 'deposit');
INSERT INTO ledger_postings (transaction_id, owner_kind, system_account, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000015', 'system', 'external_inflow', 'XLM', 'available', -300);
INSERT INTO ledger_postings (transaction_id, owner_kind, user_id, asset, bucket, amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000015', 'user', :'user2', 'XLM', 'available', 200);
COMMIT;

\echo === CASE 16: user profile creation with tag (EXPECT OK)
BEGIN;
INSERT INTO user_profiles (user_id, tag, email, phone, kyc_tier)
    VALUES (:'user1', 'alice', 'alice@example.com', '+1234567890', 1);
COMMIT;
SELECT 'CASE16_RESULT tag=' || tag || ' email=' || email || ' kyc=' || kyc_tier
    FROM user_profiles WHERE user_id = :'user1';

\echo === CASE 17: case-insensitive tag uniqueness is enforced (EXPECT ERROR duplicate key)
BEGIN;
INSERT INTO user_profiles (user_id, tag, email, kyc_tier)
    VALUES ('99999999-9999-9999-9999-999999999999', 'ALICE', 'alice2@example.com', 1);
COMMIT;

\echo === CASE 18: profile tag cannot be empty or whitespace (EXPECT ERROR check constraint)
BEGIN;
INSERT INTO user_profiles (user_id, tag, kyc_tier)
    VALUES ('88888888-8888-8888-8888-888888888888', '   ', 1);
COMMIT;

\echo === CASE 19: cascading delete removes profile when user deleted (EXPECT OK)
BEGIN;
DELETE FROM users WHERE id = :'user1';
SELECT 'CASE19_RESULT profiles_remaining=' || count(*) FROM user_profiles;
COMMIT;

\echo === FINAL: history intact after every refused attempt
SELECT 'FINAL_RESULT available=' || coalesce(sum(amount) FILTER (WHERE bucket = 'available'), 0)
       || ' held=' || coalesce(sum(amount) FILTER (WHERE bucket = 'held'), 0)
       || ' transactions=' || (SELECT count(*) FROM ledger_transactions)
FROM ledger_postings WHERE user_id = :'user1';
