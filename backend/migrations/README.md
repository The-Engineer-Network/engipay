# Migration ordering

SQLx migration versions must be unique. The repaired sequence is:

1. Ledger
2. XLM support
3. Authentication profiles (formerly `0002_auth.sql`)
4. Quarantined transfers (formerly `0002_quarantined_transfers.sql`)
5. Extended entities (formerly `0003_entities.sql`)
6. Identity immutability (formerly `0004_immutability.sql`)
7. Deposit-address constraints
8. Chain cursor support (formerly the duplicate `0002_chain_support.sql`)
9. Payment requests (formerly the duplicate `0007_payment_requests.sql`)
10. Uncredited deposit records required by the chain service

Profiles retain the authentication schema's `id` and `tier` columns. The
entities migration extends that table, and the immutability trigger checks `id`.
Chain support extends the existing deposit-address table instead of creating
a second table. Deposit-address constraints permit the shared custody addresses
used by the current API while keeping one address per user and chain.

Fresh databases can apply this sequence directly. For a database that already
applied any of the former versions, **do not apply this sequence blindly**:
back up the database, inspect its schema and `_sqlx_migrations` records, and
reconcile the applied versions and checksums with the actual schema first.
Renumbering migration files does not upgrade an existing migration history.
Disposable local databases may instead be recreated. Never delete production
data to reconcile migration history.

`scripts/verify-migrations.sh` checks unique versions, applies the sequence to a
throwaway database, and tests profile updates, tag uniqueness, and immutability.
