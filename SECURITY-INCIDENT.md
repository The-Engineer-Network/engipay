# Security Incident — Supply-Chain Backdoor (discovered 2026-09-08)

## Summary

Two commits titled `ci: add optimization workflow`, authored by
`Ocheme Emmanuel <68169194+Emzy123@users.noreply.github.com>` on 2026-05-10,
planted two independent payloads in this repository. One of them
(`1b416a9c`) was the HEAD of `main`.

Affected branches: **all 12**. Commits `1b416a9c` (10 branches) and
`5e93c778` (`remove-mock-data`, `trove-staking-pr`).

## Payload 1 — RCE loader in `postcss.config.mjs`

The legitimate config was left intact and ~9 KB of obfuscated JavaScript was
appended **on the same line**, padded with tabs/spaces so it scrolled off
screen in an editor. Two variants existed (`A8-6215`, `A8-3154-1`); the
second hid module names as `\u` escapes to defeat string scanners.

Behaviour:

1. Queries public Ethereum RPCs for the latest transaction from a hardcoded
   address (`0xa322E5f3...`).
2. Decodes that transaction's `to` field into two IPv4 addresses — the
   blockchain is used as a **rotatable dead-drop for the C2 address**, so the
   infrastructure survives takedowns.
3. Fetches stage-2 from that host, XOR-decrypts it with hardcoded keys, then
   `eval`s it **and** spawns detached `node -e` processes with
   `windowsHide: true`.

`postcss.config.mjs` is loaded on **every `next dev` and `next build`**, so any
developer who ran the app after 2026-05-10 executed this.

Observed live on 2026-09-08: PID 16524, C2 `193.247.144.38`, stage-2 at `/$/boot`.

## Payload 2 — credential exfiltration via GitHub Actions

`.github/workflows/ci-opt-1778393873.yml`, triggered `on: [push]`:

- `env > .env_data` — in Actions this captures **all repository secrets**
- probes AWS IMDSv2 (`169.254.169.254`) for IAM role credentials
- POSTs everything base64-encoded to `https://fresh-penguin-35.loca.lt/api/loot/env`

The `.gitignore` edit in the same commit was camouflage.

## Separately: plaintext key leak (predates the backdoor)

`smart-contracts/accounts.json` committed the Sepolia deployer private key
`0x06bf4e0b...` in commit `7a958a47`. It also appeared in 9 other files.
That account owns EscrowTiny, EngiTokenSimple and AtomiqAdapterSimple.
ChipiPay production keys (`sk_prod_8e503e17...`, `pk_prod_15642cd5...`) were
committed in `backend/.env.example` and 4 docs.

## Remediation performed

- Killed the running stage-2 process; verified no Run-key, Startup-folder or
  scheduled-task persistence.
- Rewrote history across all branches with `git filter-repo`, purging the
  workflow, both loader variants, `accounts.json`, the deployer key and the
  ChipiPay keys. Verified 0 residual indicators.
- Added ignore rules for key files and large binaries.

## Still required — credential rotation

| Secret | Status |
|---|---|
| Wallet seeds / private keys on any machine that built this repo | **Assume compromised.** Move funds from a clean device. |
| Starknet deployer key `0x06bf4e0b...` | Public since `7a958a47`. Generate a new account; redeploy if clean ownership is needed. |
| ChipiPay `sk_prod_8e503e17...` | **Rotate now.** |
| ChipiPay `pk_prod_15642cd5...` | Rotate. |
| All GitHub Actions secrets | Exfiltrated on every push since 2026-05-10. Rotate all. |
| GitHub PATs, SSH keys, deploy keys, OAuth apps | Revoke and reissue. |
| DB password, `JWT_SECRET`, Alchemy/Infura, SendGrid, Twilio, npm tokens | Rotate. |

## Still required — access review

Determine whether `Emzy123` is a legitimate collaborator whose account was
taken over, or an unauthorized push. **Until this is answered the door may
still be open and a cleaned repo can simply be re-infected.**

Also review: repo collaborators, org members, deploy keys, installed GitHub
Apps, and the Actions run history for `ci-opt-*`.
