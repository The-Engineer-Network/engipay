#!/usr/bin/env bash
# Verifies that sqlx migrations produce a consistent schema when applied from
# scratch, and that the full set can be applied a second time to a fresh
# database without error.
#
# Two passes are performed:
#   Pass 1 — apply all migrations to a clean database and capture the schema.
#   Pass 2 — drop and recreate the database, apply all migrations again, and
#             compare the schema to pass 1.
# A difference between the two schemas means a migration behaves differently
# depending on execution order or environment, which is a bug.
#
# Usage:
#   cd backend && ./scripts/verify-migrations.sh
#
set -euo pipefail
cd "$(dirname "$0")/.."

db="engipay_migrations_verify_$$"
psql_cmd() { docker compose exec -T postgres psql -U "${POSTGRES_USER:-engipay}" -q "$@"; }

cleanup() { psql_cmd -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" >/dev/null 2>&1 || true; }
trap cleanup EXIT

apply_migrations() {
  local target_db="$1"
  for migration in migrations/*.sql; do
    psql_cmd -d "$target_db" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
  done
}

capture_schema() {
  local target_db="$1"
  docker compose exec -T postgres \
    pg_dump --schema-only -U "${POSTGRES_USER:-engipay}" "$target_db" 2>/dev/null \
    | grep -v '^--' \
    | grep -v '^$'
}

verify_tables() {
  local target_db="$1"
  local tables=("users" "ledger_transactions" "ledger_postings" "ledger_holds" "payment_requests")
  for table in "${tables[@]}"; do
    if psql_cmd -d "$target_db" -tAc \
        "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='$table'" \
        | grep -q 1; then
      echo "  ✓ $table"
    else
      echo "  ✗ $table NOT FOUND" >&2
      exit 1
    fi
  done

  # Verify the derived view.
  if psql_cmd -d "$target_db" -tAc \
      "SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='account_balances'" \
      | grep -q 1; then
    echo "  ✓ account_balances (view)"
  else
    echo "  ✗ account_balances view NOT FOUND" >&2
    exit 1
  fi
}

# Verify that named table constraints exist.  Exits non-zero when any are
# missing so a migration that accidentally drops a constraint does not go
# unnoticed.
verify_constraints() {
  local target_db="$1"
  # Each entry is "table_name:constraint_name".
  local constraints=(
    "ledger_postings:ledger_postings_pkey"
    "ledger_transactions:ledger_transactions_reference_key"
  )
  for entry in "${constraints[@]}"; do
    local table="${entry%%:*}"
    local constraint="${entry##*:}"
    if psql_cmd -d "$target_db" -tAc \
        "SELECT 1 FROM information_schema.table_constraints
         WHERE table_schema='public'
           AND table_name='$table'
           AND constraint_name='$constraint'" \
        | grep -q 1; then
      echo "  ✓ constraint $constraint on $table"
    else
      echo "  ✗ constraint $constraint on $table NOT FOUND" >&2
      exit 1
    fi
  done
}

# Verify that named triggers exist.  Uses information_schema.triggers (not the
# constraint view) so both regular and constraint triggers are found.  Exits
# non-zero when any are missing.
verify_triggers() {
  local target_db="$1"
  # Each entry is "table_name:trigger_name".
  local triggers=(
    "ledger_transactions:ledger_transactions_append_only"
    "ledger_postings:ledger_postings_append_only"
    "ledger_holds:ledger_holds_transition"
    "ledger_postings:ledger_postings_balanced"
  )
  for entry in "${triggers[@]}"; do
    local table="${entry%%:*}"
    local trigger="${entry##*:}"
    if psql_cmd -d "$target_db" -tAc \
        "SELECT 1 FROM information_schema.triggers
         WHERE trigger_schema='public'
           AND event_object_table='$table'
           AND trigger_name='$trigger'" \
        | grep -q 1; then
      echo "  ✓ trigger $trigger on $table"
    else
      echo "  ✗ trigger $trigger on $table NOT FOUND" >&2
      exit 1
    fi
  done
}

# ── Pass 1 ─────────────────────────────────────────────────────────────────────
echo "Pass 1: applying migrations to a fresh database..."
psql_cmd -d postgres -c "CREATE DATABASE \"$db\";" >/dev/null
for migration in migrations/*.sql; do
  echo "  migrating: $(basename "$migration")"
  psql_cmd -d "$db" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done

echo "Verifying schema (pass 1)..."
verify_tables "$db"
verify_constraints "$db"
verify_triggers "$db"
schema_pass1=$(capture_schema "$db")

# ── Pass 2 (re-apply to a new database to confirm idempotency) ─────────────────
echo "Pass 2: dropping database and re-applying all migrations..."
psql_cmd -d postgres -c "DROP DATABASE \"$db\";" >/dev/null
psql_cmd -d postgres -c "CREATE DATABASE \"$db\";" >/dev/null
for migration in migrations/*.sql; do
  echo "  migrating: $(basename "$migration")"
  psql_cmd -d "$db" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done

echo "Verifying schema (pass 2)..."
verify_tables "$db"
verify_constraints "$db"
verify_triggers "$db"
schema_pass2=$(capture_schema "$db")

# ── Compare ────────────────────────────────────────────────────────────────────
echo "Comparing schemas from both passes..."
if [ "$schema_pass1" = "$schema_pass2" ]; then
  echo "✓ Schemas match — migrations are idempotent."
else
  echo "✗ Schema mismatch between pass 1 and pass 2:" >&2
  diff <(echo "$schema_pass1") <(echo "$schema_pass2") >&2
  exit 1
fi

echo "All migration verifications passed."
