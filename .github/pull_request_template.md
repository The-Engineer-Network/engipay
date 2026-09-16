## What this changes

<!-- One or two sentences. Link the issue: Closes #123 -->

## How it was tested

<!-- Commands you ran and what you checked by hand, e.g. a testnet payment. -->

## Checklist

- [ ] `npm run typecheck`, `npm test` and `npm run build` pass (web app changes)
- [ ] `cargo fmt`, `cargo clippy -- -D warnings` and `cargo test` pass (backend changes)
- [ ] No secrets, keys or `.env` files are included
- [ ] Money is handled as exact integers or decimal strings, never floating point
- [ ] Lockfile changes are intentional and explained above
