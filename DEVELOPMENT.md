# Development Guide

Welcome to EngiPay development! This guide covers the local development workflow, running tests, ensuring code quality, and submitting pull requests.

---

## 🌿 Branch Governance: `drips` Branch

- **Default Development Branch**: Active development and new features are integrated into the **`drips`** branch.
- **Production Releases**: The `main` branch is reserved for verified releases.
- **PR Requirement**: All pull requests must target `drips` and contain a line in the description:
  ```markdown
  closes #<issue number>
  ```
  Pull requests that meet these criteria and pass CI are automatically merged!

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
