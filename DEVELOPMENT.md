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
