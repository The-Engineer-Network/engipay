# Contributing to EngiPay

Thanks for helping. EngiPay moves people's money, so this guide is mostly about the few rules that keep it safe. Everything else is ordinary open-source practice.

## Ways to help

- **Pick up an issue.** Issues labelled `good first issue` are small and well scoped. Each one says what done looks like.
- **Report a bug** with the bug report template. Include the network (testnet or mainnet), the wallet, and the steps.
- **Improve the docs.** If something in the README did not work for you, that is a bug in the README.
- **Propose a feature** with the feature request template. Check the scope below first.

Comment on an issue before starting work on it, so two people do not build the same thing. If you have not opened a pull request within a week, the issue goes back to the pool.

## Scope

EngiPay does four things: Naira on and off ramps, scan to pay and receive, wallet to wallet transfers, and funding EngiPay to send or convert. It runs on Stellar, Base and Bitcoin.

Out of scope: lending, staking, yield, trading features, NFTs, and new chains. [PLAN.md](PLAN.md) explains why and is the source of truth.

## Setting up

### Web app

Node.js 20.9 or newer.

```bash
npm ci --ignore-scripts
cp .env.example .env.local
npm run dev
```

For Stellar work, install [Freighter](https://www.freighter.app/), switch it to Testnet, and fund an account with [Friendbot](https://lab.stellar.org/account/fund).

### Backend

Docker only. You do not need Rust installed.

```bash
cd backend
cp .env.example .env    # set POSTGRES_PASSWORD
docker compose build toolbox
docker compose run --rm toolbox cargo test
```

## Before you open a pull request

Run what CI runs. A pull request that fails CI is not reviewed until it passes.

```bash
# Web app
npm run typecheck
npm test
npm run build

# Backend
cd backend
docker compose run --rm toolbox cargo fmt --all
docker compose run --rm toolbox cargo clippy --workspace --all-targets -- -D warnings
docker compose run --rm toolbox cargo test --workspace
```

Keep pull requests small and about one thing. Fill in the template, including how you tested. For anything that sends a transaction, say which testnet transaction you checked it with.

## The rules that matter

### Money

- **Never use floating point for money.** Backend amounts are whole smallest units in `i128` (`engipay_core::Money`). Frontend amounts stay as decimal strings or `bigint` until the moment they are formatted for display.
- **Refuse, do not round.** An amount with more decimals than the asset supports is an error the user sees, not something silently trimmed.
- **Validate addresses fully**, checksum included, before anything is signed. Stellar addresses go through `isStellarAddress` on the web and `engipay_core::stellar::parse_address` on the backend.
- **Only real assets.** A token is identified by its issuer or contract address, never by its name. Anyone can issue a token called USDC.
- **Every ledger change balances and is idempotent.** Use the ledger crate. Do not write to ledger tables directly.

### Keys and secrets

- **No secret ever enters the repository**: no keys, seed phrases, API keys or `.env` files, not even in tests. Test keys are generated from fixed bytes in the test itself.
- **Signing keys live only in the chain service.** The web app never sees a key: the user's own wallet signs.
- **Local signing keys are testnet-only.** `LocalTestnetSigner` refuses mainnet on purpose. Do not remove that check.

### Dependencies

- **Every new dependency needs a reason** in the pull request description. Prefer packages maintained by the Stellar Development Foundation, the Rust project, or the maintainers of libraries we already use.
- **Install with `--ignore-scripts`.** Dependency install scripts do not run in CI, and should not run on your machine either.
- **Lockfile changes get read in review.** Do not commit an unrelated lockfile churn.

EngiPay's own repository was compromised through a malicious build config in 2026. These rules exist because of that.

## Code style

- **Match the code around you**, including comment style: comments explain why, not what.
- **Rust:** `cargo fmt`, and clippy with warnings as errors. `unsafe` is forbidden workspace-wide. Avoid `unwrap` outside tests.
- **TypeScript:** strict mode. Names should say what a thing is. Components stay small, and logic that decides where money goes lives in `lib/` with tests.
- **User-facing text:** plain language. Error messages say what happened and what to do next.

## Commits and pull requests

Use a short prefix that says what kind of change it is:

```
feat(stellar): read memos from SEP-7 codes
fix(send): refuse amounts with more than 7 decimals on Stellar
docs: explain funding a testnet account
chore(deps): bump wagmi
```

A maintainer reviews every pull request. The `main` branch is protected: changes land through reviewed pull requests with passing CI, never by direct push.

## Issue labels

| Label | Meaning |
| --- | --- |
| `good first issue` | Small, well scoped, a good place to start |
| `stellar`, `base`, `web`, `backend` | Area of the code |
| `complexity: trivial`, `complexity: medium`, `complexity: high` | Rough size of the work |
| `needs design` | Agree on the approach in the issue before writing code |

## License

EngiPay is licensed under the [Apache License 2.0](LICENSE). By contributing, you agree that your contribution is licensed under the same terms.

## Conduct

Be kind and assume good intent. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
