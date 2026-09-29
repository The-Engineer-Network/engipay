#!/usr/bin/env bash
# Proves the database refuses to corrupt the ledger.
#
# Creates a throwaway database, applies every migration, attempts each forbidden
# write, checks that Postgres refused exactly those, then drops the database.
# Your development data is never touched.
#
#   cd backend && docker compose up -d postgres && ./scripts/test-db-guarantees.sh
set -euo pipefail
cd "$(dirname "$0")/.."

db="engipay_guarantees_$$"
psql() { docker compose exec -T postgres psql -U "${POSTGRES_USER:-engipay}" -q "$@"; }

cleanup() { psql -d postgres -c "DROP DATABASE IF EXISTS $db;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -d postgres -c "CREATE DATABASE $db;" >/dev/null
for migration in migrations/*.sql; do
  psql -d "$db" -v ON_ERROR_STOP=1 -f - < "$migration" >/dev/null
done

output=$(psql -d "$db" -v ON_ERROR_STOP=0 -t -f - < scripts/test-db-guarantees.sql 2>&1)

failures=0
expect() {
  if grep -q -- "$2" <<<"$output"; then
    printf '  pass  %s\n' "$1"
  else
    printf '  FAIL  %s  (expected: %s)\n' "$1" "$2"
    failures=$((failures + 1))
  fi
}

echo "Database ledger guarantees:"
expect "balanced deposit commits"             "CASE1_RESULT balance=100"
expect "unbalanced transaction refused"       "does not balance for USDC"
expect "negative user balance refused"        "would make user"
expect "editing a posting refused"            "UPDATE on ledger_postings is not allowed"
expect "deleting a posting refused"           "DELETE on ledger_postings is not allowed"
expect "deleting a transaction refused"       "DELETE on ledger_transactions is not allowed"
expect "reused reference refused"             "ledger_transactions_reference_key"
expect "zero amount refused"                  "ledger_postings_amount_check"
expect "unknown asset refused"                "ledger_postings_asset_check"
expect "reopening a settled hold refused"     "hold wd-1 is already settled"
expect "XLM deposit commits and balances"     "CASE11_RESULT balance=500"
expect "XLM transfer balances"                "CASE12_RESULT user1=300 user2=200"
expect "XLM hold moves to held bucket"        "CASE13_RESULT available=150 held=150"
expect "XLM settlement moves money out"       "CASE14_RESULT user1_held=0 outflow=135 fees=15"
expect "XLM unbalanced transaction refused"   "does not balance for XLM"
expect "user profile creation works"          "CASE16_RESULT tag=alice email=alice@example.com kyc=1"
expect "case-insensitive tag uniqueness"      "duplicate key"
expect "empty tag rejected"                   "user_profiles_tag_check"
expect "cascading delete removes profile"     "CASE19_RESULT profiles_remaining=0"
expect "history intact after every refusal"   "FINAL_RESULT available=150 held=0 transactions=6"

if [ "$failures" -gt 0 ]; then
  echo "$failures guarantee(s) FAILED"
  exit 1
fi
echo "All guarantees hold."
