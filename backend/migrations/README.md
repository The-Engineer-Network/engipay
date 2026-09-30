# Migration ordering

SQLx migration versions must be unique. The repaired sequence is:

1. Ledger
2. XLM support
3. Authentication profiles (formerly `0002_auth.sql`)
4. Quarantined transfers (formerly `0002_quarantined_transfers.sql`)
5. Extended entities (formerly `0003_entities.sql`)
6. Identity immutability (formerly `0004_immutability.sql`)

Profiles retain the authentication schema's `id` and `tier` columns. The
entities migration extends that table, and the immutability trigger checks `id`.

Fresh databases can apply this sequence directly. For a database that already
applied any of the former versions, **do not apply this sequence blindly**:
back up the database, inspect its schema and `_sqlx_migrations` records, and
reconcile the applied versions and checksums with the actual schema first.
Renumbering migration files does not upgrade an existing migration history.
Disposable local databases may instead be recreated. Never delete production
data to reconcile migration history.

`scripts/verify-migrations.sh` checks unique versions, applies the sequence to a
throwaway database, and tests profile updates, tag uniqueness, and immutability.
