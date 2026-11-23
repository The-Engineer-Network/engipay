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
