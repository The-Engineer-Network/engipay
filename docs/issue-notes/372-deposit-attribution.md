# Issue #372: How Base and Bitcoin deposits are attributed to a user

Status: **decision recorded** — per-user HD-derived addresses on both chains. Build work is
split into the five follow-up issues listed at the end of this document (drafted on #372; see
[Recording this decision](#recording-this-decision)).

## Problem

Every user is shown the same custody address on Base and on Bitcoin, so a deposit arriving at
that address carries nothing that identifies its owner:

| Chain | What the user is given | Can a watcher tell whose it is? |
|---|---|---|
| Stellar | `M...` muxed address, muxed ID = lower 64 bits of the user's UUID | Yes — the ID is in the address |
| Base | shared `BASE_CUSTODY_ADDRESS` (`0x...`) | No |
| Bitcoin | shared `BITCOIN_CUSTODY_ADDRESS` (`bc1...`) | No |

Stellar does not have this problem because muxed addresses exist: attribution is encoded in the
destination itself. Base and Bitcoin have no equivalent, so today a deposit to either custody
address can never be credited automatically.

### Code map (what exists today)

| Piece | Where | Behaviour |
|---|---|---|
| Provisioning | `backend/crates/api/src/routes/deposits.rs` (`provision_custody`) | Returns the shared custody address for `chain=base\|bitcoin`; stores `derivation_index = COUNT(*)` for that chain. The doc comment says per-user derivation waits on "the day the chain service exposes key derivation". |
| Attribution | `backend/crates/chain/src/deposit_creditor.rs` (`resolve_user`) | Only parses Stellar `Muxed` addresses; **everything else is routed to the DLQ** as `DlqReason::UnknownRecipient`. |
| Resolver | `backend/crates/chain/src/services/account_resolver.rs` | LRU cache keyed by muxed ID; unknown IDs are never cached. |
| Base watcher | `backend/crates/chain/src/evm/eth.rs`, `erc20.rs` | Already takes `deposit_addresses: &HashSet<String>` and matches `tx.to` / the ERC-20 `to` topic against it. |
| Bitcoin watcher | `backend/crates/chain/src/bitcoin/utxo.rs` (`UtxoWatcher`) | Already built from a registry: `register_address(address, script_pubkey)`. |
| Schema | `backend/migrations/0003_chain_support.sql`, `0008_deposit_address_constraints.sql` | `deposit_addresses(user_id, chain, address, muxed_id, derivation_index)`, `UNIQUE (user_id, chain)`; the old `UNIQUE (chain, address)` was **dropped in 0008** precisely because all users share one address today. |
| Dead-letter queue | `backend/migrations/0010_uncredited_deposits.sql`, `backend/crates/chain/src/dlq.rs` | Unattributable deposits are stored with `pending_investigation` for manual handling. |
| Key custody | `backend/crates/chain/src/lib.rs` | The chain service is the only process that ever holds signing keys. The API service holds none. |

Two observations shape every option below:

1. The watchers were already written for per-user addresses (`HashSet<String>`, UTXO registry).
   Attribution is blocked at provisioning and at `resolve_user`, not at observation.
2. There is no Solidity or contract toolchain anywhere in the repository today.

## Constraints

- **Custodial.** Users never hold keys. Whatever we do, one party must be able to spend from
  every deposit address.
- **The API stays keyless.** Compromising the API must not let an attacker move funds. Any
  solution must either derive addresses from a watch-only xpub or delegate derivation to the
  chain service.
- **Money is never guessed.** A deposit that cannot be attributed with certainty must keep
  going to the DLQ rather than be credited to a plausible user.
- **Both chains.** A design that only works on one chain leaves the other on manual crediting.
- **Stellar stays as it is.** The muxed-address path is working and is not part of this change.

## Options considered

### Option A — per-user HD-derived addresses (BIP32)

Each user gets an address derived from a master extended key, one index per user per chain.

- **Bitcoin:** BIP39 seed → BIP32 master → BIP84 receive path `m/84'/0'/0'/0/<i>` (coin type
  `1` on testnet), native SegWit v0. Scanning runs off the xpub, which is watch-only.
- **Base:** the same (or a second) master, BIP44 path `m/44'/60'/0'/0/<i>`, producing an EOA.
  Users pay the EOA; USDC arrives as an ERC-20 transfer to it.

**Key custody**

- One master seed per chain, generated offline, held only by the chain service and encrypted at
  rest. Separate seeds for Bitcoin and Base so a leak of one does not expose both chains.
- The xpub can be distributed for watch-only scanning (address generation, deposit detection)
  without any spend capability; the seed never leaves the signer process.
- The custody model becomes that of a real custodian: backup of the seed becomes a production
  asset, and a restore drill (re-derive the first N addresses from backup) is required, because
  losing the seed means funds at derived addresses can never be swept.
- Blast radius: whoever holds the master can spend every user's deposit. This is the same trust
  users already place in EngiPay for the Stellar custody account — the difference is that the
  key now controls *all* Base/Bitcoin deposits instead of one shared address, so backup,
  separation and (later) HSM/offline signing matter more.

**Sweeping cost**

- *Bitcoin:* funds land in many UTXOs instead of one. Sweeping is consolidation: batch N
  deposit UTXOs into a single transaction paying the custody address. Cost scales with input
  count (a P2WPKH input is roughly 11 vB of witness plus its output and overhead), paid in
  sats, and is fully under our control: funds sitting at a derived address are already ours, so
  the sweeper can run on a threshold or schedule (never below dust) instead of per deposit.
  Restart safety requires recording which outpoints are already spent.
- *Base:* a fresh EOA holds USDC but no ETH, so moving anything out requires gas the address
  does not have. Every sweep therefore costs the sweeper a gas float (a small ETH send) plus
  the transfer — one or two L2 transactions per address. Base fees are small, but the cost is
  per-address and recurring, and each EOA adds nonce/gas bookkeeping. Mitigations: sweep only
  above a threshold with a gas-cost safety factor, batch users' sweeps in one worker run, and
  revisit Option B later if this ever dominates. The alternative of paying gas from the deposit
  address itself (user funds it) is not available for USDC-only deposits.

**Watcher mapping**

- One row per user: `deposit_addresses(chain, address, user_id, derivation_index)`. The watcher
  matches on `address` (EVM `HashSet`, UTXO registry) and resolves through an address-keyed
  lookup with the same cache semantics as `AccountResolver` (known addresses cached, unknown
  ones never cached). Deposits to addresses that are not in the table — including the legacy
  shared custody address — keep going to the DLQ.
- The existing table fits, but three things must change: `derivation_index` needs a real
  allocator (`COUNT(*)` races and cannot detect collisions) backed by
  `UNIQUE (chain, derivation_index)`; `UNIQUE (chain, address)` must come back (dropped in
  migration 0008); and the rows all users currently hold for `chain=base|bitcoin`, which all
  contain the *same* custody address, must be migrated, otherwise an address-keyed lookup
  returns many users for one address.
- Newly provisioned addresses must reach the watchers, or a user who deposits moments after
  signing up is missed: refresh the watched set when `deposit_addresses` changes.

**Pros**

- One mechanism for both chains; one watcher path; no new on-chain code to audit.
- Attribution is deterministic at observation time — the address *is* the user.
- Fits the schema and the watchers exactly as they were written (`derivation_index` exists
  for this).
- Privacy: deposits are no longer all traceable to one shared address.

**Cons**

- Key management becomes real: seed generation, backup, restore drills, index bookkeeping,
  gap-limit handling on Bitcoin, no address reuse accidents.
- Base sweeping costs gas per EOA and needs a gas-float strategy.
- One leaked master is catastrophic; mitigation is process (separation, storage, drills), not
  code.

### Option B — per-user forwarding contracts on Base

A small immutable `Forwarder` contract, deployed per user as an EIP-1167 minimal proxy at a
CREATE2 address whose salt is the user's ID, so the address is computable *before* deployment
(counterfactual: show the user an address, deploy on first touch). ETH is forwarded to custody
inside the deposit transaction; ERC-20 is pulled later by a batched `sweep(...)` that moves
many users' tokens in one transaction. A simpler variant — one shared router contract where
users call `depositFor(userId)` — was considered too and is discussed below.

**Key custody**

- Unchanged for keys: still one custody key, contracts hold nothing between deposit and sweep.
- The risk moves into the contract: an immutable Forwarder with a bug is a permanent loss of
  funds, so this option implies introducing Foundry (or similar), contract tests, an audit, a
  deployment ceremony and a decision on upgradeability. Making it upgradeable reintroduces an
  admin key that can drain users — a worse custody story than Option A.

**Sweeping cost** — the strongest argument for this option

- No gas-float problem: ETH is forwarded in the deposit transaction (the depositor pays), and
  ERC-20 balances are consolidated by one batched sweep whose gas is amortised across all
  users. Clones never need ETH of their own, and nonce management stays in one contract
  instead of thousands of EOAs.
- Costs: one-off clone deployment gas per user (~45k gas for a minimal proxy, paid on first
  touch) plus the forwarding/sweep transactions.

**Watcher mapping**

- Same table, same lookup: the CREATE2 address is derived from the user ID, or the row simply
  stores it. A `Deposited(user, amount)` event makes attribution trivially explicit, but the
  address→user table still does the work, so this option buys no simplification of the
  watcher.

**Pros:** cheapest sweeping on Base; programmable attribution; explicit events.
**Cons:**

- Solves Base only. Bitcoin still needs Option A, so the project pays for two mechanisms,
  two provisioning paths and two sweep strategies.
- New contract surface in a repository with no contract toolchain, no auditors and a mandate
  to keep the change small; this is a payments custodian, where contract risk is the worst
  kind of risk.
- The shared-router variant has the original problem back: an ERC-20 `transfer` carries no
  memo, so users must approve-and-call (two transactions, or permit) and a plain ETH transfer
  to the router with no data is unattributable — plus the router then holds every user's
  balance at once, the largest possible honeypot.

### Option C — shared address plus off-chain attribution (status quo, extended)

Keep one custody address per chain and attribute after the fact: deposits land in the DLQ and
an operator credits them (already implemented: `uncredited_deposits`, `pending_investigation`
→ `reprocessed`). Variants: unique-amount references (the user is told to send an amount with
a unique trailing value, matched like a bank transfer), or a signed claim where the user proves
control of the sending wallet (only possible for self-custody senders, not exchange
withdrawals).

**Key custody:** simplest of all — one key, one address, no derivation, no backup questions
beyond today's.

**Sweeping cost:** zero extra — funds arrive directly at custody. Bitcoin accumulates UTXOs at
one address (consolidation is trivial); the Base custody EOA already holds the ETH used for
withdrawals.

**Watcher mapping:** there is none. Attribution happens after observation, by matching amounts
or by a human. Deposits that do not match stay in the DLQ.

**Pros:** no new code or key material, works today, and remains the right *fallback* for any
deposit we cannot attribute (including funds already sent to the shared custody address).

**Cons:**

- Not automatic and not linear: operations load grows with deposit count, and every manual
  credit is a chance to credit the wrong user.
- Amount matching collides with exchange batched withdrawals (many unrelated users share
  amounts and sender addresses), and a user who sends the wrong amount is unmatched.
- No on-chain link between user and deposit: weaker audit trail, and reconciliation keeps
  seeing custody surplus that "may contain unprocessed deposits"
  (`backend/crates/chain/src/workers/reconcile.rs`).
- Users share one address, so every depositor is linkable on-chain to every other one.

## Comparison

| | A: HD-derived addresses | B: Forwarding contracts (Base) | C: Off-chain attribution |
|---|---|---|---|
| Attribution | Deterministic, at observation | Deterministic, at observation | After the fact, by ops |
| Key custody | Master seed per chain in chain service; backup + restore drill required | Unchanged keys, new contract risk | Unchanged from today |
| Sweeping: Bitcoin | Consolidation txs, threshold-controlled | *n/a* (still needs A) | Trivial (one address) |
| Sweeping: Base | Gas float per EOA, threshold sweeps | Cheapest — batched, no floats | None (already at custody) |
| Watcher mapping | `address → user_id` table lookup | Same table lookup (+ optional event) | No mapping; manual/DLQ |
| Chains covered | Both | Base only | Both, manually |
| New attack/audit surface | Operational (key handling) | Contract correctness (audit) | Human error |
| Fits existing code | Yes — watchers and schema anticipate it | Requires new toolchain | Exists today |

## Decision

**Option A — per-user HD-derived addresses on both Base and Bitcoin.**

Rationale:

1. **It is the design the code already anticipates.** `derivation_index` exists for it,
   migration 0008 says the address constraint was dropped "until the chain service exposes
   per-user key derivation", both watchers accept address sets, and `provision_custody` is
   explicitly a placeholder.
2. **One mechanism, both chains.** Option B only covers Base; combining B with A would mean
   two provisioning paths, two sweep strategies and two audits of the same idea.
3. **Attribution is certain and immediate**, satisfying the "money is never guessed"
   constraint without operator involvement.
4. **No new on-chain code.** For a custodian, moving risk from "boring key operations we can
   document" to "unaudited contracts holding user funds" is the wrong trade.

**Rejected:** Option B — not wrong engineering, wrong moment: it solves the cheaper half of the
problem (Base sweeps), needs a contract toolchain and audit this repository does not have, and
its benefits can be revisited later *without re-architecting anything*: attribution under
Option A is a table lookup, so swapping Base receiving to forwarders later only changes
provisioning and sweeping. Option C — cannot scale past a handful of deposits and puts a human
between every deposit and the ledger; **retained as the fallback path** for unattributable
deposits (the DLQ does this today and keeps doing it).

## Consequences of the decision

- **Provisioning:** `provision_custody` derives `(address, derivation_index)` instead of
  returning the shared address. The API stays keyless: either it holds the watch-only xpub, or
  (preferred) it asks the chain service to derive over the existing internal HTTP surface, so
  index allocation is serialised in one process and no key material crosses services.
- **Schema:** `UNIQUE (chain, derivation_index)` for safe allocation; restore
  `UNIQUE (chain, address)`; migrate the existing shared-address rows for `chain=base|bitcoin`
  (today every user has a row containing the same custody address, which an address-keyed
  lookup cannot disambiguate) — either re-provision on next request or mark them legacy and
  keep crediting them via the DLQ.
- **Watcher:** address-keyed resolution next to the muxed path in `resolve_user`; refresh the
  watched address set when rows are added; unknown addresses (including the shared custody
  address) still go to the DLQ, so funds already sent there remain recoverable by operators.
- **Sweeping:** a new worker, threshold-driven, restart-safe; Base needs a documented gas
  strategy; Bitcoin sweeps whole UTXOs to avoid change handling.
- **Key custody:** a runbook before the first seed is generated (see follow-ups).
- **Unchanged:** Stellar muxed addresses, ledger idempotency (`reference` per deposit),
  confirmation depths (Base 12, Bitcoin 2, Stellar 1), DLQ workflow.

## Follow-up issues

Issue creation in this repository is restricted to collaborators (the REST API answers `404`
and GraphQL answers `does not have the correct permissions to execute CreateIssue` for
non-collaborators), so these five are drafted for maintainers to file — they are posted in
full on #372, and each links back to it. Titles are final; bodies are ready to paste.

1. **chain: derive per-user Base and Bitcoin deposit addresses from an HD seed (BIP32/BIP84/BIP44)**
   Derivation module in the chain service: deterministic paths, watch-only xpub, index
   allocation under `UNIQUE (chain, derivation_index)`, gap-limit handling, no key material on
   the internal HTTP surface. *Depends on: nothing.*
2. **api: return per-user derived deposit addresses for Base and Bitcoin instead of the shared custody address**
   Replace `provision_custody`, restore address uniqueness, migrate legacy shared-address
   rows, keep the API keyless, update the receive screen. *Depends on: 1.*
3. **chain: attribute Base and Bitcoin deposits to a user in DepositCreditor (address → user_id)**
   Address-keyed resolver beside the muxed path, watcher set refresh, DLQ fallback for
   unknown/legacy addresses, tests mirroring the muxed cases. *Depends on: 1, 2.*
4. **chain: sweep worker for per-user deposit addresses (Bitcoin consolidation, Base gas float)**
   Threshold sweeps, outpoint/nonce bookkeeping, restart safety, the documented Base gas
   strategy, metrics for swept vs unswept balance. *Depends on: 1; lands after 3.*
5. **docs: key custody runbook for the deposit derivation seed (backup, restore drill, per-chain separation)**
   Generation offline, per-chain seed separation, offline backups, periodic restore drill,
   compromise response, future HSM hardening. *Depends on: nothing; must merge before 1.*

## Recording this decision

- The decision and its trade-offs are recorded in this file and summarised in a comment on
  #372 (the issue body asks for it there; comments are not restricted, issue creation is).
- The pull request that adds this document carries `Closes #372`.

## Risks accepted

- Seed custody is now a first-class production asset; the runbook (follow-up 5) is a
  prerequisite for follow-up 1, not an afterthought.
- Base sweeping costs gas per address and adds per-EOA operational work; mitigated by
  threshold sweeps, and re-evaluable against Option B if it ever dominates operating cost.
- Existing users keep shared-address rows until re-provisioned; deposits to those addresses
  stay in the DLQ and are credited manually — no user funds are stranded, but operators keep
  handling them until follow-up 2 ships.
