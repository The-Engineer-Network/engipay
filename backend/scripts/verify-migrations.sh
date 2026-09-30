#!/usr/bin/env bash
# Applies all migrations to a throwaway database and checks the resulting schema.
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

# SQLx identifies migrations by numeric version, not the full filename.
duplicates=$(printf '%s\n' migrations/*.sql | sed 's|.*/||; s/_.*//' | sort | uniq -d)
if [ -n "$duplicates" ]; then
  echo "Duplicate SQLx migration versions: $duplicates" >&2
  exit 1
fi

# Apply all migrations
echo "Applying migrations..."
for migration in migrations/*.sql; do
  echo "  Migrating: $(basename "$migration")"
  psql -d "$db" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done

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
constraints=("ledger_postings_amount_check" "ledger_postings_asset_check")
for constraint in "${constraints[@]}"; do
  if psql -d "$db" -Atc "SELECT 1 FROM pg_constraint WHERE conname = '$constraint' LIMIT 1" | grep -qx "1"; then
    echo "  ✓ Constraint/Trigger '$constraint' exists"
  else
    echo "Missing constraint: $constraint" >&2
    exit 1
  fi
done
triggers=("ledger_transactions_append_only" "ledger_postings_append_only" "user_profiles_immutable_fields")
for trigger in "${triggers[@]}"; do
  if ! psql -d "$db" -Atc "SELECT 1 FROM pg_trigger WHERE tgname = '$trigger' LIMIT 1" | grep -qx "1"; then
    echo "Missing trigger: $trigger" >&2
    exit 1
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

psql -d "$db" -v ON_ERROR_STOP=1 -f - < scripts/test-profile-migrations.sql
echo "All migration verifications passed."
