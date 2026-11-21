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

## 🧪 Testing Rules for Contributors

1. **Every Issue Requires a Test**: No code is merged without unit or integration tests verifying expected behavior and edge cases.
2. **Zero Floating Point**: Use `Money` (integer minor units in `i128`).
3. **No Plaintext Secrets**: Never commit `.env` files or keys.
