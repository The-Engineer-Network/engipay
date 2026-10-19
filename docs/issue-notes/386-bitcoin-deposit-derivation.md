# Design: Per-User Bitcoin Deposit Addresses (BIP-84)

## Overview
This design describes the hierarchical deterministic (HD) address derivation scheme for per-user Bitcoin deposit addresses in EngiPay, enabling automated deposit attribution.

## Key Derivation Scheme
- **Derivation standard**: BIP-84 (Native SegWit `bc1q...` P2WPKH).
- **Derivation path**: `m/84'/0'/0'/0/{derivation_index}` for Mainnet, `m/84'/1'/0'/0/{derivation_index}` for Testnet.
- **Account Extended Public Key (xpub / zpub)**:
  - Stored securely in environment/vault configuration (`BITCOIN_XPUB`).
  - The API service only ever holds the extended public key and never possesses the master private key.
  - Addresses are derived on demand when a user requests a Bitcoin deposit address, incrementing `derivation_index` monotonically stored in `deposit_addresses`.

## Gap Limit & Address Registration
- **Gap Limit**: Set to 20 per BIP-44/84 recommendations.
- The chain service watcher loads all active `deposit_addresses` associated with Bitcoin and registers their `scriptPubKey` with the UTXO filter in `UtxoWatcher`.

## Sweeping Strategy
- UTXOs deposited to user deposit addresses are swept periodically to the cold custody multi-sig vault when:
  1. The UTXO has attained >= 2 confirmations.
  2. The fee environment is favorable (mempool congestion below threshold).
  3. Batch sweeping multiple inputs into a single output to amortize transaction fees.
