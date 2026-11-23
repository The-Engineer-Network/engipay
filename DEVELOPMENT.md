# Development Guide

Welcome to EngiPay development! This guide covers the local development workflow, running tests, ensuring code quality, and submitting pull requests.

---

## 🌿 Branch Governance: `main` Branch

- **Single Branch**: `main` is the only long-lived branch. Branch from it and open pull requests against it.
- **PR Requirement**: All pull requests must target `main` and contain a line in the description:
  ```markdown
  closes #<issue number>
  ```
- **Review**: Pull requests need passing CI and a maintainer's review. Nothing is merged automatically.

---

## 🔍 Running CI Checks Locally

Before opening a pull request, run the exact test suite executed by CI:

### 1. Web App (Next.js & TypeScript)

Requires Node.js 20.9+ (Node 22 recommended).

```bash
# Install dependencies securely without running arbitrary install scripts
npm ci --ignore-scripts --no-fund

# Typecheck TypeScript codebase
npm run typecheck

# Run unit tests
npm test

# Build production bundle
npm run build

# Browser smoke tests against the production build (run after `npm run build`)
npx playwright install chromium
npm run test:e2e

# Run dependency audit
npm audit --audit-level=high
```

### API client decision (#670)

The web app's canonical path to the EngiPay API is the typed client: use
`lib/api.ts` for shared transport concerns (API base URL, authentication and
error parsing) and `lib/api-client.ts` for typed endpoint wrappers. This keeps
authentication and error handling in one place.

The Next.js `/api` rewrite remains temporarily for existing raw callers. Those
call sites will be migrated in follow-up issues; once they are gone, the
rewrite can be removed. Direct calls to external services such as Horizon and
RPC endpoints are outside this decision.

### 2. Backend (Rust Workspace)

The Rust workspace resides in `backend/`. You can run checks locally via `cargo` or inside the provided Docker environment:

```bash
cd backend

# Format check
cargo fmt --all --check

# Clippy linter (zero warnings policy)
cargo clippy --workspace --all-targets --locked -- -D warnings

# Run all unit and integration tests
cargo test --workspace --locked
```

Alternatively, with Docker:
```bash
cd backend
docker compose run --rm toolbox cargo clippy --workspace --all-targets -- -D warnings
docker compose run --rm toolbox cargo test --workspace
```

### 3. Database & Ledger Invariants (PostgreSQL)

EngiPay's double-entry ledger is guarded by append-only database triggers. Validate the schema guarantees:

```bash
cd backend

# Start Postgres in background
echo "POSTGRES_PASSWORD=ci-only-not-a-secret" > .env
docker compose up -d --wait postgres

# Run database integrity assertions
bash ./scripts/test-db-guarantees.sh
```

---

## 🔐 Running the chain service with `CHAIN_INTERNAL_TOKEN`

The chain service (`engipay-chain`) exposes an internal HTTP API under
`/internal/*` that the API service calls for chain data such as fee estimates.
It is not a public API: it should only be reachable over loopback or a private
container network.

### Listen address

Both ways of running the internal server bind to the loopback address
`127.0.0.1:8081` by default:

- `engipay-chain serve` reads `CHAIN_HTTP_ADDR`.
- The default watch mode (`engipay-chain` with no subcommand) reads
  `CHAIN_INTERNAL_ADDR` for the same internal server.

If either variable is set to a non-loopback address, the service refuses to
start unless `CHAIN_INTERNAL_TOKEN` is set, so the internal API is never exposed
without a credential.

### The token

`CHAIN_INTERNAL_TOKEN` is a shared secret between the chain service and its
caller. Pick a long random value and set it in the environment before starting
the service:

```bash
export CHAIN_INTERNAL_TOKEN="$(openssl rand -hex 32)"
cd backend && cargo run -p engipay-chain -- serve
```

When the token is set, every request to `/internal/*` must carry it. The value is
compared in constant time; a missing or mismatched value is rejected with
`401 Unauthorized` before it reaches a handler. The `/metrics` endpoint is
always reachable without the token. When the token is unset, no credential is
required — acceptable only because the default listener is loopback-only.

### How the API sends the header

The API authenticates by sending the same value in an `X-Internal-Token` HTTP
header on every request to the chain service's internal API. For example:

```bash
curl -X POST http://127.0.0.1:8081/internal/estimate-fee \
  -H 'Content-Type: application/json' \
  -H "X-Internal-Token: $CHAIN_INTERNAL_TOKEN" \
  -d '{"chain":"stellar","asset":"XLM","amount":"1","destination":"GAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHV4"}'
```

The caller and the chain service must therefore use the same
`CHAIN_INTERNAL_TOKEN` value.

---

## 🧪 Testing Rules for Contributors

1. **Every Issue Requires a Test**: No code is merged without unit or integration tests verifying expected behavior and edge cases.
2. **Zero Floating Point**: Use `Money` (integer minor units in `i128`).
3. **No Plaintext Secrets**: Never commit `.env` files or keys.

---

## 💸 Money-Moving Endpoint Checklist

Every endpoint that moves money (send, withdraw, buy, convert) **must** implement all of these:

1. **`AuthUser` extractor**: Reject unauthenticated requests.
2. **User ID from session only**: Never take the user ID from the request body or query string. Always read it from the authenticated session.
3. **Frozen check**: Refuse to proceed if the user account is frozen. Use the account status check helper.
4. **Velocity limits**: Enforce transaction frequency and amount limits to prevent abuse. Apply rate-limiting middleware or helpers.
5. **Hold before external effects**: Place a hold on the user's balance before calling external APIs or signing blockchain transactions. Only release the hold after success or permanent failure.
6. **Idempotency key**: Accept and enforce an idempotency key so retries do not create duplicate transactions.
7. **One transaction**: Wrap all ledger updates in a single database transaction that rolls back on error.
8. **Exact `Money` type**: Use `engipay_core::Money` (integer smallest units in `i128`) for all amounts. No floating point, no rounding.
9. **Tests**: Include unit tests for success, insufficient balance, frozen account, and idempotency key reuse.

For implementation details, see:
- Authentication: `engipay_api::extractors::AuthUser`
- Frozen check: `engipay_ledger::accounts::is_frozen`
- Holds: `engipay_ledger::holds`
- Idempotency: `engipay_ledger::idempotency`
- Money type: `engipay_core::Money`

Endpoints that skip any of these steps will be rejected in review.

## 🔐 Backend Quickstart: Getting a Session Token

This section shows you how to authenticate with the EngiPay backend and get a working session token using curl.

### Prerequisites

- A test Ethereum-compatible wallet with a private key
- `curl` installed
- `cast` from Foundry toolkit (for signing), or Node.js with ethers

### Step 1: Request a nonce

```bash
# Replace with your wallet address
ADDRESS="0x1234567890123456789012345678901234567890"

curl -X POST https://api.engipay.io/v1/auth/nonce \
  -H "Content-Type: application/json" \
  -d "{\"address\": \"$ADDRESS\"}"
```

**Response:**
```json
{
  "nonce": "Sign this message to authenticate with EngiPay: abc123def456"
}
```

### Step 2: Sign the nonce with your private key

Using `cast` (Foundry):
```bash
NONCE="Sign this message to authenticate with EngiPay: abc123def456"
PRIVATE_KEY="0xYourPrivateKeyHere"

SIGNATURE=$(cast wallet sign --private-key $PRIVATE_KEY "$NONCE")
echo "Signature: $SIGNATURE"
```

Or using Node.js:
```javascript
const { Wallet } = require('ethers');
const wallet = new Wallet('0xYourPrivateKeyHere');
const nonce = 'Sign this message to authenticate with EngiPay: abc123def456';
const signature = await wallet.signMessage(nonce);
console.log('Signature:', signature);
```

### Step 3: Verify the signature and get your token

```bash
curl -X POST https://api.engipay.io/v1/auth/verify-evm \
  -H "Content-Type: application/json" \
  -d "{
    \"address\": \"$ADDRESS\",
    \"signature\": \"$SIGNATURE\"
  }"
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user_id": "usr_1234567890"
}
```

### Step 4: Use the token to access protected endpoints

```bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Get your user profile
curl https://api.engipay.io/v1/me \
  -H "Authorization: Bearer $TOKEN"
```

**Response:**
```json
{
  "tag": "@yourname",
  "tier": 1,
  "daily_limit": "1000000"
}
```

### Done!

You now have a working session token that you can use to test all authenticated endpoints locally. The token can be used in your local development environment by setting it in localStorage:

```javascript
localStorage.setItem('engipay-token', 'your-token-here');
```
