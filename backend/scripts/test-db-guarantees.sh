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
expect "valid deposit address inserts"        "CASE11_RESULT chain=stellar"
expect "duplicate address refused"            "deposit_addresses_address_key"
expect "duplicate user+chain refused"         "deposit_addresses_user_id_chain_key"
expect "invalid chain refused"                "deposit_addresses_chain_check"
expect "valid bank account inserts"           "CASE15_RESULT verified=t"
expect "duplicate bank account refused"       "bank_accounts_user_id_bank_code_account_number_key"
expect "valid conversion inserts"             "CASE17_RESULT status=quoted"
expect "invalid conversion status refused"    "conversions_status_check"
expect "valid ramp order inserts"             "CASE19_RESULT direction=on_ramp"
expect "invalid ramp direction refused"       "ramp_orders_direction_check"
expect "duplicate partner_ref refused"        "ramp_orders_partner_ref_key"
expect "invalid ramp status refused"          "ramp_orders_status_check"
expect "history intact after every refusal"  "FINAL_RESULT available=60 held=40 transactions=2"

if [ "$failures" -gt 0 ]; then
  echo "$failures guarantee(s) FAILED"
  exit 1
fi
echo "All guarantees hold."
