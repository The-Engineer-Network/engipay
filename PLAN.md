EngiPay - Product and Technical Plan (v2)

Written 12 September 2026. Owner: adenueltech.
This replaces the Starknet and DeFi direction.


1. THE CORE FEATURES

These four are the product. Nothing else ships.

1.1 On-ramp and off-ramp (Naira)
    Buy crypto with Naira from a Nigerian bank account or card, and sell crypto
    back into Naira paid out to a Nigerian bank account. Supported both ways for
    USDC, ETH and BTC.

1.2 Scan to pay and scan to receive
    Show a QR code to get paid. Scan someone's QR code to pay them. Works
    between two EngiPay users, and with any outside wallet that reads standard
    payment codes.

1.3 BTC transfers, wallet to wallet
    Plain Bitcoin sending. A user sends BTC from their EngiPay balance to any
    Bitcoin address, and receives BTC from anywhere into their EngiPay address.
    Real Bitcoin on the Bitcoin network, not a wrapped token.

1.4 Add a wallet, fund EngiPay, then send or convert
    A user connects their own external wallet (MetaMask, Trust, Coinbase
    Wallet), moves funds into their EngiPay account, and from inside EngiPay
    they can:
      - send to any other wallet address, EngiPay or not
      - convert one token into another, for example USDC to ETH, or BTC to USDC
      - withdraw back out to their own external wallet at any time


2. HOW MONEY MOVES

2.1 Funding the account
    Each user gets a deposit address per chain (one EVM address, one Bitcoin
    address). They send funds there from their own wallet, or from any exchange.
    The chain service watches those addresses, waits for the required
    confirmations, then credits the user's balance in the ledger.

    Confirmations before crediting:
      Bitcoin      2 confirmations
      Base / EVM   12 blocks

2.2 Sending out
    The user picks an asset, an amount and a destination address. The API checks
    the balance and limits, the chain service builds and signs the transaction,
    broadcasts it, and tracks it to confirmation. The ledger is debited when the
    transaction is broadcast, not when it confirms, so a user cannot spend the
    same funds twice while a send is in flight.

2.3 Scan to pay
    The receiver opens Receive, optionally types an amount and picks an asset,
    and gets a QR code. The sender scans it, sees who they are paying and how
    much, and confirms. If both users are on EngiPay the transfer is an internal
    ledger move: instant, no network fee, no waiting for confirmations. If the
    code belongs to an outside wallet it becomes a normal on-chain send.

2.4 Converting one token to another
    The user picks what they hold and what they want, sees a quote with the rate
    and the fee and an expiry countdown, and confirms before the quote expires.

      Token to token on the same chain, for example USDC to ETH:
        executed through a DEX aggregator on Base.
      Across chains, for example BTC to USDC:
        executed through a liquidity partner, because it crosses two networks.

    Both paths end the same way: the user's balances are updated in one atomic
    ledger operation, so a failure mid-way never leaves a half-finished swap.

2.5 On-ramp, Naira in
    The user enters a Naira amount, gets a quote, completes KYC if it is their
    first time, and pays by bank transfer or card. The provider confirms payment
    and the crypto lands in the user's EngiPay balance.

2.6 Off-ramp, Naira out
    The user picks an asset and amount, gets a quote, and confirms. The balance
    is held immediately so it cannot be spent twice, the crypto goes to the
    payout partner, and Naira is paid to the user's verified bank account.

2.7 One order state machine for ramps and conversions

      quoted -> awaiting_payment -> payment_received -> processing -> completed
                                                     -> failed
                                                     -> expired
                                                     -> refunded

    Rules that do not bend: quotes expire in 60 to 120 seconds and are
    re-checked before execution; every order is idempotent on a key sent by the
    client; the ledger is append-only; a balance change is written before it is
    shown to the user.


3. WHAT CUSTODY MEANS FOR US

Feature 1.4 means EngiPay holds customer funds. That decision drives everything
else in this document, so it is worth stating plainly.

What it gives us:
    Instant EngiPay-to-EngiPay payments with no gas fee, in-app conversion,
    simple recovery when a user loses their phone, and a normal fintech
    experience for people who do not want to manage a seed phrase.

What it costs us:
    We are responsible for other people's money. That means licensing and
    compliance obligations in Nigeria, an AML and transaction monitoring
    programme, daily reconciliation between the chain and the ledger, insurance
    or capital cover, and hot and cold wallet operations.

The three rules that follow from it:
    a. Keys never touch the API service or any TypeScript code. They live in the
       chain service, behind a KMS or HSM.
    b. Hot wallets hold only what is needed for daily outflow. Everything else
       is in cold storage, and moving funds out of cold storage needs two people.
    c. The ledger is the source of truth for balances, never the chain. The
       chain is reconciled against the ledger on a schedule, and any drift
       raises an alert immediately.

Get written confirmation of the licensing position before taking real customer
money. This is a legal question, not an engineering one, and it does not have an
engineering workaround.


4. CHAINS AND ASSETS

    Bitcoin      native BTC, real Bitcoin network
    Base         USDC, ETH

Base is the EVM chain because fees are low, it settles quickly, and it is what
the Naira ramp partners quote against. Adding another EVM chain later is mostly
configuration, since addresses and signing are shared. Adding a non-EVM chain is
a real project each time, the way Bitcoin is.


5. ARCHITECTURE

    Web app, Next.js
      wallet connect, send and receive, QR, convert, ramp screens
        |
        | HTTPS
        v
    API service, Rust (Axum), with Postgres
      accounts and auth, KYC, balances and ledger, orders and quotes,
      limits and fraud checks, partner webhooks, notifications, admin
        |                                  |
        | internal HTTP                    | HTTPS
        v                                  v
    Chain service, Rust (separate binary) Outside partners
      key custody, deposit watching,     Naira ramp and payout provider,
      building and signing, fee          DEX aggregator for same-chain swaps,
      estimation, confirmations,         KYC provider
      Bitcoin UTXOs, EVM nonces

The chain service stays small on purpose. Everything it exposes:

    create_wallet(user_id, chain)          -> deposit address
    get_balances(address)                  -> balances on chain
    estimate_fee(chain, asset, amount)     -> fee
    send(chain, from, to, asset, amount)   -> tx hash
    get_transaction(chain, tx_hash)        -> status and confirmations
    watch_deposits(chain, address)         -> incoming transfer events

Repository layout. The web app stays at the root for now; the backend is one
Cargo workspace beside it:

    engipay/
      app/, components/, lib/   the Next.js web app
      backend/
        Cargo.toml              workspace; every dependency declared once
        crates/core/            assets, exact money, identifiers
        crates/ledger/          double-entry ledger rules
        crates/api/             Axum HTTP API (binary: engipay-api)
        crates/chain/           chain service (binary: engipay-chain)
        migrations/             Postgres schema, applied at API startup
        Dockerfile              builds either binary
        docker-compose.yml      Postgres, the API, and a Rust toolbox


6. THE STACK DECISION

Decided on 15 September 2026: Rust for both the API and the chain service.

What that means in practice:
    One language, one Cargo workspace, and one set of domain types
    (engipay-core) shared by the API and the chain service. The money type and
    the ledger rules exist exactly once, and both services use the same code.

    The API is Axum on Tokio, with SQLx on Postgres. The chain service is a
    separate binary, because it is the only process that will ever hold
    signing keys. Compromising the API must not give an attacker the ability
    to move funds.

    Base will use alloy, and Bitcoin will use bdk and rust-bitcoin.

The cost we accepted:
    Ramp partners and KYC providers publish JavaScript SDKs, not Rust ones, so
    each integration is written against their HTTP API directly. That is more
    work per partner, but it also means no third-party SDK code runs inside the
    service that moves money.

How it is built:
    In Docker, not on a developer machine. Dependency build scripts run inside a
    throwaway container, never next to wallets or credentials. This follows
    directly from the September 2026 compromise.

Guardrails from day one:
    Money is whole smallest units in i128, with no floating point, and amounts
    with more precision than the asset has are rejected, not rounded.
    unsafe code is forbidden workspace-wide. Cargo.lock is committed. The
    database refuses UPDATE and DELETE on ledger rows, and rejects any
    transaction that does not balance, so even an application bug cannot
    corrupt the ledger.


7. QR CODE FORMAT

Use the standard EIP-681 format so that any wallet, not just EngiPay, can read
our codes:

    ethereum:0x<address>@8453
    ethereum:0x<token>@8453/transfer?address=0x<to>&uint256=<amount>

Bitcoin uses the BIP-21 standard:

    bitcoin:<address>?amount=0.0015

For EngiPay-to-EngiPay payments we wrap the standard code so we can carry a
note, a reference and the user's tag, while staying readable to outside wallets:

    {
      "v": 1,
      "type": "engipay.request",
      "chain": "base",
      "to": "0x...",
      "asset": "USDC",
      "amount": "25.00",
      "tag": "@adenuel",
      "ref": "inv_123",
      "uri": "ethereum:0x...@8453"
    }

The uri field is never optional. It is what makes the code work in wallets that
have never heard of EngiPay. The scanner reads JSON first, then EIP-681, then
BIP-21, then a bare address.


8. API SURFACE, FIRST CUT

    POST /auth/nonce                 wallet sign-in challenge
    POST /auth/verify                verify signature, start session
    GET  /me                         profile, KYC status, limits
    PUT  /me/bank-account            payout bank details

    GET  /assets                     supported assets, limits, fees
    GET  /balances                   ledger balances for the user
    GET  /transactions               unified history: deposits, sends,
                                     conversions, ramp orders

    GET  /deposit-address            per chain, created on first request
    POST /withdrawals                send out to an external address
    POST /transfers                  internal EngiPay to EngiPay transfer

    POST /payment-requests           create a QR request, returns uri and qr
    GET  /payment-requests/:id

    POST /convert/quote              asset in, asset out, amount
    POST /convert/orders             accept a quote and execute
    GET  /convert/orders/:id

    POST /ramp/quote                 direction, asset, amount
    POST /ramp/orders                accept a quote
    GET  /ramp/orders/:id
    POST /ramp/webhook               partner callbacks, signature verified

    POST /kyc/session                start provider KYC


9. DATA MODEL

    users              id, tag, email, phone, status, created_at
    kyc_records        user_id, provider, level, status, verified_at
    bank_accounts      user_id, bank_code, account_number, account_name,
                       verified
    deposit_addresses  user_id, chain, address, derivation_path
    balances           user_id, asset, available, held
    ledger_entries     append-only: user_id, asset, debit, credit, ref_type,
                       ref_id, created_at
    transactions       id, user_id, direction, chain, asset, amount, address,
                       tx_hash, status, confirmations
    conversions        id, user_id, asset_in, asset_out, amount_in, amount_out,
                       rate, fee, route, status
    ramp_orders        id, user_id, direction, asset, crypto_amount,
                       ngn_amount, rate, fee, partner, partner_ref, status,
                       expires_at
    webhook_events     provider, event_id unique, payload, processed_at

Rules: money is stored as numeric, never as a float. Every amount has its
currency or asset stored beside it. A balance is available plus held, and held
covers funds committed to an in-flight send, conversion or off-ramp.
webhook_events.event_id is unique so a replayed callback does nothing twice.


10. SECURITY RULES

Written after the September 2026 supply-chain attack, which cost every
credential on the development machine.

    a. No secrets in the repository, ever. Env files are git-ignored and
       production secrets live in the host's secret store.
    b. Signing keys only in the chain service, behind a KMS or HSM. No key
       material in TypeScript, and none in the repository.
    c. Withdrawals above a set limit need a second approval, and new withdrawal
       addresses have a cooling-off period.
    d. Every partner webhook is signature-verified and idempotent.
    e. Rate-limit everything that touches money, and log every state change with
       who did it and when.
    f. Dependencies are reviewed like code. Lockfile changes get read in review,
       and the global git hooks in the .git-hooks folder block the injected
       loader pattern on commit and push.
    g. Force-push protection on the main branch of every repository.
    h. Daily reconciliation between chain state and ledger, with alerts on any
       mismatch.


11. BUILD ORDER

Everything here needs the backend, so the backend comes first.

    1. Foundation
       Rust API (Axum), Postgres, wallet sign-in, user accounts, the ledger and
       the balance model. Nothing is user-visible yet, and everything else
       stands on it.
       Started 15 September 2026: workspace, exact money type, ledger rules
       with tests, database schema with append-only and balance checks, API
       health and assets endpoints, and a chain service skeleton.

    2. Chain service and deposits
       Rust service, EVM and Bitcoin wallets, deposit addresses, watching for
       incoming funds, crediting the ledger. At this point a user can fund an
       EngiPay account from an outside wallet.

    3. Sending out
       Withdrawals to external addresses on both chains, plus internal EngiPay
       to EngiPay transfers. Now money moves in both directions.

    4. Scan to pay and receive
       Receive screen with the QR code, scanner that reads all four formats,
       payment requests with amounts. The frontend already has the scanner and
       the send form to build on.

    5. Conversion
       DEX aggregator for same-chain swaps, liquidity partner for BTC against
       tokens, quotes with expiry, the conversion order flow.

    6. Naira ramps
       Partner integration, KYC, quotes, orders, bank payouts, webhooks. Last
       because it needs the ledger, verified identity and working custody
       underneath it.

    7. Hardening before real money
       Cold storage split, withdrawal approvals, reconciliation, monitoring,
       admin tools, external security review.


12. WHAT WAS REMOVED, AND WHERE IT IS

Starknet was removed from the product on 12 September 2026. Nothing was deleted.
It was moved to the .withheld folder, which is git-ignored and still on disk.

    backend/            Node and Express API tied to Starknet, Vesu, Atomiq,
                        ChipiPay and Tongo, 127 files
                        now .withheld/legacy-starknet/backend/
    smart-contracts/    Cairo contracts, 129 files, 27 MB
                        now .withheld/legacy-starknet/smart-contracts/
    abis/               Starknet ABIs
                        now .withheld/legacy-starknet/abis/
    DeFi panels         lending, staking, yield farming, rewards, analytics
                        now .withheld/defi/
    Swap panels         BtcSwap, CrossChainBalance, Escrow, SwapHistory,
                        SwapStatusTracker
                        now .withheld/payments/

Also cleaned: the network picker that defaulted to Starknet Mainnet, and the
block explorer links that pointed at Starkscan. The product tree now has zero
Starknet references, checked across app, components, lib, contexts, hooks and
types. TypeScript compiles clean.


13. WHERE THE FRONTEND STANDS TODAY

The screens were rebuilt on 12 September 2026 around the four features. Every
route below exists and builds.

    /                    landing page
    /dashboard           home: the six actions, balances, recent activity
    /send                send ETH or USDC on Base to any address
    /receive             your QR code, with an optional amount and asset
    /scan                camera scanner that reads a payment code
    /convert             token to token
    /buy                 Naira in
    /sell                Naira out
    /activity            one list of everything
    /settings            wallet, appearance, account
    /about /faq /features /help /privacy /technology    marketing

The signed-in screens sit in the app route group, so the header, the navigation
and the connect-wallet guard are written once in app/(app)/layout.tsx.

Working for real today, with no backend:
    Next.js 14 App Router, TypeScript, Tailwind, shadcn/ui
    wagmi v2, viem and RainbowKit, wallet discovery through EIP-6963
    Base network, test network in development and mainnet in production
    Sending native ETH and ERC-20 tokens, waiting for the receipt
    Live token balances from the connected wallet
    A real QR scanner. The old one was a placeholder that always returned
    nothing, so scanning never worked. It now uses html5-qrcode.
    Payment codes, read and written, in lib/payment-uri.ts: EIP-681, BIP-21,
    the EngiPay envelope, and bare addresses
    The receive screen renders a standard code, so other wallets can pay it

Designed but waiting on the backend. Each of these screens is complete, with
the action disabled and a line saying which service is missing, rather than a
fake result:
    Convert          needs pricing and the swap route
    Buy and Sell     need the Naira partner and the identity check
    Activity         needs indexed history
    Settings         profile, identity check and payout bank account
    Bitcoin          needs the chain service, so BTC shows as present but
                     cannot be sent yet

Old UI moved to .withheld/old-ui/: the previous dashboard and payments-swaps
pages, PaymentModals, DashboardNavigation, QuickActions, BalanceCard,
ActivityCard, TransactionHistory, the dead app/api/auth proxies and
lib/api-config.ts. Nothing in the app imports them any more.


14. OPEN QUESTIONS

    a. Stack: decided on 15 September 2026 - Rust for both. See section 6.
    b. Ramp partner: any existing relationship, or a preference among Yellow
       Card, Onramp.money, Transak, Quidax and Busha.
    c. KYC: run by the ramp partner, or our own with Dojah or Smile ID. You
       already use Dojah elsewhere.
    d. Company: is there a registered entity and a bank relationship for
       settlement. Partners require both, and so does custody.
    e. Licensing: what is the current position on holding customer funds in
       Nigeria. This one gates the launch date, so it is worth answering early.
    f. Repository: move the web app into apps/web now, or keep it flat until
       the API exists.
