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

\echo === FINAL: history intact after every refused attempt
SELECT 'FINAL_RESULT available=' || coalesce(sum(amount) FILTER (WHERE bucket = 'available'), 0)
       || ' held=' || coalesce(sum(amount) FILTER (WHERE bucket = 'held'), 0)
       || ' transactions=' || (SELECT count(*) FROM ledger_transactions)
FROM ledger_postings WHERE user_id = :'user1';
