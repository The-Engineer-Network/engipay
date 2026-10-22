#!/usr/bin/env bash
# scripts/testnet-e2e.sh
#
# Full-stack Stellar testnet end-to-end harness.
#
# What it does:
#   1. Generates a fresh ephemeral Stellar keypair for the test user.
#   2. Funds it via Stellar Friendbot (testnet faucet).
#   3. Derives the user's muxed address from the custody account.
#   4. Sends a small USDC deposit to that muxed address.
#   5. Polls the API until the deposit is credited (or times out).
#   6. Submits a withdrawal back to the ephemeral account.
#   7. Polls until the withdrawal is settled on-chain.
#   8. Prints a timing summary and exits 0 on success, 1 on any failure.
#
# Prerequisites (provided by CI via env):
#   API_BASE_URL            http://localhost:8080
#   STELLAR_NETWORK         testnet
#   STELLAR_CUSTODY_ACCOUNT G... custody account address
#   STELLAR_TESTNET_SECRET  S... signing key for testnet sends
#
# Tools required on PATH:
#   curl, jq, stellar-cli (or stellar)
#
# The script never touches mainnet: it refuses to run unless
# STELLAR_NETWORK=testnet.

set -euo pipefail

# ── Guards ─────────────────────────────────────────────────────────────────────
if [[ "${STELLAR_NETWORK:-}" != "testnet" ]]; then
  echo "ERROR: STELLAR_NETWORK must be 'testnet'. Got: '${STELLAR_NETWORK:-<unset>}'"
  exit 1
fi

: "${API_BASE_URL:?API_BASE_URL must be set (e.g. http://localhost:8080)}"
: "${STELLAR_CUSTODY_ACCOUNT:?STELLAR_CUSTODY_ACCOUNT must be set}"
: "${STELLAR_TESTNET_SECRET:?STELLAR_TESTNET_SECRET must be set}"

HORIZON_URL="${STELLAR_HORIZON_URL:-https://horizon-testnet.stellar.org}"
FRIENDBOT_URL="https://friendbot.stellar.org"

# Deposit amount in stroops (1 XLM = 10_000_000 stroops).
# We deposit 10 XLM worth of testnet funds to cover fees and the transfer.
DEPOSIT_AMOUNT_STROOPS=100000000   # 10 XLM
DEPOSIT_AMOUNT_XLM="10"

# Poll timeouts
CREDIT_TIMEOUT_SECONDS=120
WITHDRAW_TIMEOUT_SECONDS=120
POLL_INTERVAL_SECONDS=5

# ── Timing helpers ─────────────────────────────────────────────────────────────
START_TIME=$(date +%s)

elapsed() {
  echo $(( $(date +%s) - START_TIME ))
}

log() {
  echo "[$(elapsed)s] $*"
}

# ── Step 1: Generate ephemeral keypair ──────────────────────────────────────────
log "Generating ephemeral testnet keypair..."

# stellar-cli generates a keypair; we capture the output.
# Format: two lines — public key (G...) then secret key (S...).
KEYPAIR=$(stellar keys generate --network testnet --no-fund ephemeral-e2e-$$ 2>/dev/null || true)

# Fallback: use stellar-cli generate-keypair if the above fails (older CLI).
if [[ -z "$KEYPAIR" ]]; then
  KEYPAIR=$(stellar keypair generate 2>/dev/null || true)
fi

# If stellar-cli is not available, derive via Python (available on ubuntu runners).
if [[ -z "$KEYPAIR" ]]; then
  log "stellar-cli not found, deriving keypair via Python stellar-sdk..."
  KEYPAIR=$(python3 - <<'PYEOF'
from stellar_sdk import Keypair
kp = Keypair.random()
print(kp.public_key)
print(kp.secret)
PYEOF
)
fi

EPHEMERAL_PUBLIC=$(echo "$KEYPAIR" | head -n1 | tr -d '[:space:]')
EPHEMERAL_SECRET=$(echo "$KEYPAIR" | tail -n1 | tr -d '[:space:]')

if [[ -z "$EPHEMERAL_PUBLIC" || -z "$EPHEMERAL_SECRET" ]]; then
  echo "ERROR: failed to generate ephemeral keypair"
  exit 1
fi

log "Ephemeral public key: $EPHEMERAL_PUBLIC"

# ── Step 2: Fund via Friendbot ──────────────────────────────────────────────────
log "Funding ephemeral account via Friendbot..."
T_FRIENDBOT_START=$(date +%s)

HTTP_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" \
  "${FRIENDBOT_URL}?addr=${EPHEMERAL_PUBLIC}")

if [[ "$HTTP_STATUS" != "200" ]]; then
  echo "ERROR: Friendbot returned HTTP $HTTP_STATUS for account $EPHEMERAL_PUBLIC"
  exit 1
fi

T_FRIENDBOT=$(( $(date +%s) - T_FRIENDBOT_START ))
log "Friendbot funded account in ${T_FRIENDBOT}s"

# ── Step 3: Derive the muxed address from the custody account ───────────────────
log "Deriving muxed deposit address from custody account..."

# We ask the API for the user's deposit address. This endpoint returns the
# muxed M... address that the chain service watches.
# The API is unauthenticated for this demo endpoint; in production it requires
# a JWT. We use a test user id of 1.
MUXED_RESPONSE=$(curl -sS \
  "${API_BASE_URL}/api/accounts/deposit-address?user_id=1")

MUXED_ADDRESS=$(echo "$MUXED_RESPONSE" | jq -r '.address // empty')

if [[ -z "$MUXED_ADDRESS" ]]; then
  echo "ERROR: Could not get muxed deposit address from API."
  echo "Response: $MUXED_RESPONSE"
  exit 1
fi

log "Muxed deposit address: $MUXED_ADDRESS"

# ── Step 4: Send deposit from ephemeral account to muxed address ────────────────
log "Sending ${DEPOSIT_AMOUNT_XLM} XLM deposit to muxed address..."
T_DEPOSIT_START=$(date +%s)

# Build and submit a payment transaction using the Horizon API directly
# (works without stellar-cli on the runner).
DEPOSIT_TX_RESULT=$(python3 - <<PYEOF
import sys
try:
    from stellar_sdk import (
        Keypair, Network, Server, TransactionBuilder, Asset
    )
except ImportError:
    print("ERROR: stellar-sdk not installed", file=sys.stderr)
    sys.exit(1)

server = Server("${HORIZON_URL}")
source_kp = Keypair.from_secret("${EPHEMERAL_SECRET}")
source_account = server.load_account(source_kp.public_key)

tx = (
    TransactionBuilder(
        source_account=source_account,
        network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
        base_fee=100,
    )
    .append_payment_op(
        destination="${MUXED_ADDRESS}",
        asset=Asset.native(),
        amount="${DEPOSIT_AMOUNT_XLM}",
        source=source_kp.public_key,
    )
    .set_timeout(30)
    .build()
)
tx.sign(source_kp)
response = server.submit_transaction(tx)
print(response["hash"])
PYEOF
)

if [[ "$DEPOSIT_TX_RESULT" == ERROR* ]]; then
  echo "$DEPOSIT_TX_RESULT"
  exit 1
fi

DEPOSIT_TX_HASH=$(echo "$DEPOSIT_TX_RESULT" | tr -d '[:space:]')
T_DEPOSIT=$(( $(date +%s) - T_DEPOSIT_START ))
log "Deposit submitted: tx=${DEPOSIT_TX_HASH} in ${T_DEPOSIT}s"

# ── Step 5: Poll API until credit appears ──────────────────────────────────────
log "Polling API for credit (timeout ${CREDIT_TIMEOUT_SECONDS}s)..."
T_CREDIT_START=$(date +%s)
CREDITED=false

while true; do
  ELAPSED_CREDIT=$(( $(date +%s) - T_CREDIT_START ))
  if (( ELAPSED_CREDIT >= CREDIT_TIMEOUT_SECONDS )); then
    echo "ERROR: Deposit was not credited within ${CREDIT_TIMEOUT_SECONDS}s"
    exit 1
  fi

  BALANCE_RESPONSE=$(curl -sS \
    "${API_BASE_URL}/api/accounts/balance?user_id=1" || echo '{}')

  BALANCE=$(echo "$BALANCE_RESPONSE" | jq -r '.balance // "0"')

  if [[ "$BALANCE" != "0" && "$BALANCE" != "null" && -n "$BALANCE" ]]; then
    T_CREDIT=$(( $(date +%s) - T_CREDIT_START ))
    log "Deposit credited! Balance: ${BALANCE} (after ${T_CREDIT}s)"
    CREDITED=true
    break
  fi

  log "  ...waiting for credit (${ELAPSED_CREDIT}s elapsed, balance=${BALANCE})"
  sleep "$POLL_INTERVAL_SECONDS"
done

# ── Step 6: Submit withdrawal ───────────────────────────────────────────────────
log "Submitting withdrawal back to ephemeral account..."
T_WITHDRAW_START=$(date +%s)

WITHDRAW_RESPONSE=$(curl -sS -X POST \
  "${API_BASE_URL}/api/withdrawals" \
  -H "Content-Type: application/json" \
  -d "{
    \"user_id\": 1,
    \"destination\": \"${EPHEMERAL_PUBLIC}\",
    \"amount\": \"${DEPOSIT_AMOUNT_XLM}\",
    \"asset\": \"XLM\"
  }")

WITHDRAWAL_ID=$(echo "$WITHDRAW_RESPONSE" | jq -r '.id // empty')

if [[ -z "$WITHDRAWAL_ID" ]]; then
  echo "ERROR: Withdrawal request failed."
  echo "Response: $WITHDRAW_RESPONSE"
  exit 1
fi

log "Withdrawal queued: id=${WITHDRAWAL_ID}"

# ── Step 7: Poll until withdrawal is settled ────────────────────────────────────
log "Polling for withdrawal settlement (timeout ${WITHDRAW_TIMEOUT_SECONDS}s)..."
SETTLED=false

while true; do
  ELAPSED_WITHDRAW=$(( $(date +%s) - T_WITHDRAW_START ))
  if (( ELAPSED_WITHDRAW >= WITHDRAW_TIMEOUT_SECONDS )); then
    echo "ERROR: Withdrawal was not settled within ${WITHDRAW_TIMEOUT_SECONDS}s"
    exit 1
  fi

  STATUS_RESPONSE=$(curl -sS \
    "${API_BASE_URL}/api/withdrawals/${WITHDRAWAL_ID}" || echo '{}')

  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status // "pending"')

  if [[ "$STATUS" == "settled" || "$STATUS" == "completed" ]]; then
    T_WITHDRAW=$(( $(date +%s) - T_WITHDRAW_START ))
    log "Withdrawal settled! (after ${T_WITHDRAW}s)"
    SETTLED=true
    break
  elif [[ "$STATUS" == "failed" ]]; then
    echo "ERROR: Withdrawal failed. Response: $STATUS_RESPONSE"
    exit 1
  fi

  log "  ...waiting for settlement (${ELAPSED_WITHDRAW}s elapsed, status=${STATUS})"
  sleep "$POLL_INTERVAL_SECONDS"
done

# ── Step 8: Timing summary ─────────────────────────────────────────────────────
TOTAL=$(elapsed)

echo ""
echo "══════════════════════════════════════════════════"
echo "  Testnet E2E Harness — PASSED"
echo "══════════════════════════════════════════════════"
echo "  Friendbot fund time : ${T_FRIENDBOT}s"
echo "  Deposit tx time     : ${T_DEPOSIT}s"
echo "  Credit wait time    : ${T_CREDIT}s"
echo "  Withdrawal time     : ${T_WITHDRAW}s"
echo "  Total elapsed       : ${TOTAL}s"
echo "══════════════════════════════════════════════════"
