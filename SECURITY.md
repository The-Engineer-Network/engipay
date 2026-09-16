# Security policy

EngiPay handles money. We take every report seriously and are grateful to people who report problems responsibly.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub:

**[Report a vulnerability](https://github.com/The-Engineer-Network/engipay/security/advisories/new)**

Include what you found, how to reproduce it, and what an attacker could do with it. A proof of concept on testnet is ideal.

What happens next:

- We acknowledge your report within **3 working days**.
- We tell you whether we confirmed it, and our plan, within **10 working days**.
- We credit you in the advisory when it is published, unless you prefer not to be named.

## Supported versions

Only the `main` branch is supported. EngiPay is not yet running with real customer funds.

## In scope

- The web app in this repository
- The Rust API and chain service in `backend/`
- Payment code parsing: anything that could send money to the wrong address, asset or amount
- Handling of keys, secrets and signing
- The CI configuration and dependency supply chain

## Out of scope

- Findings that need a compromised device or browser extension
- Denial of service through volume alone
- Missing security headers with no demonstrated impact
- Vulnerabilities in third-party wallets such as Freighter or MetaMask. Please report those to their maintainers.

## Rules for research

- **Use testnet only.** Never test against real funds, mainnet accounts, or anyone else's wallet or data.
- **Do not access or change data that is not yours**, and stop as soon as you have shown the problem.
- **Give us reasonable time to fix it** before disclosing publicly.

If you follow these rules, we will not pursue legal action against you for your research.

## If you find a secret

If you find a key, token or password in this repository or its history, report it privately as above, even if you think it is old. Do not use it.
