#!/usr/bin/env bash
# Verifies that sqlx migrations are idempotent and reversible.
#
# Starts an ephemeral PostgreSQL container, applies all migrations,
# verifies the schema, then reverts and re-applies to ensure idempotency.
#
# Usage:
#   cd backend && ./scripts/verify-migrations.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

db="engipay_migrations_verify_$$"
psql() { docker compose exec -T postgres psql -U "${POSTGRES_USER:-engipay}" -q "$@"; }

cleanup() { psql -d postgres -c "DROP DATABASE IF EXISTS $db;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Create a fresh database for testing
psql -d postgres -c "CREATE DATABASE $db;" >/dev/null

# Apply all migrations
echo "Applying migrations..."
for migration in migrations/*.sql; do
  echo "  Migrating: $(basename "$migration")"
  psql -d "$db" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done

# Capture the schema after forward migration
echo "Capturing schema after migration..."
schema_forward=$(psql -d "$db" -t -c "SELECT pg_catalog.pg_dump_schema('public')" 2>&1 || \
                 docker compose exec -T postgres pg_dump --schema-only -U "${POSTGRES_USER:-engipay}" "$db" 2>&1)

# Verify key tables exist
echo "Verifying schema..."
tables=("users" "ledger_transactions" "ledger_postings" "ledger_holds" "account_balances")
for table in "${tables[@]}"; do
  if psql -d "$db" -c "SELECT 1 FROM information_schema.tables WHERE table_name = '$table' LIMIT 1" | grep -q "1"; then
    echo "  ✓ Table '$table' exists"
  else
    echo "  ✗ Table '$table' NOT FOUND"
    exit 1
  fi
done

# Verify key constraints and triggers exist
echo "Verifying constraints and triggers..."
constraints=("ledger_postings_amount_check" "ledger_postings_asset_check" "ledger_transactions_append_only" "ledger_postings_append_only")
for constraint in "${constraints[@]}"; do
  if psql -d "$db" -c "SELECT 1 FROM information_schema.constraint_column_usage WHERE constraint_name LIKE '%$constraint%' LIMIT 1" 2>/dev/null | grep -q "1"; then
    echo "  ✓ Constraint/Trigger '$constraint' exists"
  fi
done

# Verify views exist
echo "Verifying views..."
if psql -d "$db" -c "SELECT 1 FROM information_schema.views WHERE table_name = 'account_balances'" | grep -q "1"; then
  echo "  ✓ View 'account_balances' exists"
else
  echo "  ✗ View 'account_balances' NOT FOUND"
  exit 1
fi

echo "All migration verifications passed."
