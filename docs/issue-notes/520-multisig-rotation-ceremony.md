# Multisig Custody Account — Rotation Ceremony

This document describes how to configure and maintain 2-of-N multisig on the
EngiPay Stellar custody account, and how to rotate signers safely.

## Account configuration

| Property | Value | Why |
|---|---|---|
| Signer weight | 1 per key | Uniform weights make the maths simple |
| Low threshold | 1 | Allow-trust and bump-sequence ops (low risk) |
| Med threshold | 2 | Payment operations |
| High threshold | 2 | SetOptions, AccountMerge (account-altering ops) |
| Master key weight | 0 | Disabled after initial setup |

With N ≥ 2 signers at weight 1 and med/high thresholds both set to 2:

- Any two signers can authorise a payment.
- Any two signers can add or remove another signer.
- No single key can do anything alone.

## Initial one-time setup

Run this once when the custody account graduates from single-key to multisig.

1. Generate two or more new Ed25519 keypairs using Stellar Laboratory or the
   `stellar-strkey` CLI. On mainnet, generate the keys inside your KMS or HSM
   and never export them; on testnet `stellar-strkey` is fine.

2. Run the setup command (testnet example):

   ```bash
   export STELLAR_CUSTODY_ACCOUNT=G...
   export STELLAR_NETWORK=testnet
   export STELLAR_TESTNET_SECRET=S...   # current single master key

   cargo run -p engipay-chain -- multisig-setup \
     <signer-A-G...> \
     <signer-B-G...>
   ```

3. The command prints a signed transaction envelope (base64 XDR). Copy it into
   [Stellar Laboratory](https://lab.stellar.org/transaction/sign) to verify the
   operations before submitting.

4. Submit the transaction. Once it lands:
   - The master key weight is 0 (disabled).
   - Signer A and Signer B each have weight 1.
   - Low/med/high thresholds are 1/2/2.
   - All future transactions need signatures from at least 2 signers.

## Adding a signer

Adding a signer does not reduce capacity, so no pre-checks are needed.

```bash
cargo run -p engipay-chain -- signer-add <new-G...key>
```

The command prints a partially-signed envelope. Collect a second signature from
another existing signer (Stellar Laboratory or a co-signer CLI), then submit.

## Removing a signer

The command refuses if the removal would leave total weight below the high
threshold, preventing the account from being permanently locked.

```bash
cargo run -p engipay-chain -- signer-remove <G...key-to-remove>
```

If the command fails with "InsufficientWeight", add a replacement signer first,
then remove the old one — or use `signer-rotate` to do both atomically.

## Rotating a signer (recommended)

`signer-rotate` adds the new key and removes the old key in a single
transaction. The add operation comes first so the account never drops below
threshold weight, even for a fraction of a ledger.

```bash
cargo run -p engipay-chain -- signer-rotate \
  <old-G...key> \
  <new-G...key>
```

What happens:

1. The command fetches the current account state from Horizon.
2. It verifies the old key exists on the account.
3. It verifies the new key is not already present.
4. It builds a SetOptions transaction with two operations:
   a. Add the new key (weight 1).
   b. Remove the old key (weight 0).
5. It signs with the provided key and prints the envelope.

The second signature needed to meet the threshold must be added offline or by
the co-signer before submitting.

## Listing current signers

```bash
cargo run -p engipay-chain -- signer-list
```

Prints the account's current thresholds and all signers with their weights.

## Invariants enforced by the tooling

1. **No duplicates.** `signer-add` and `signer-rotate` refuse if the new key is
   already on the account.

2. **No orphan account.** `signer-remove` checks that the remaining total weight
   meets the high threshold before building the transaction.

3. **Atomic rotation.** `signer-rotate` puts add and remove in one transaction;
   the network applies both or neither.

4. **No mainnet local keys.** `LocalTestnetSigner` refuses to construct on
   mainnet. Mainnet operations require a `KmsBackend` implementation that
   delegates signing to an HSM or cloud KMS without ever exporting the key.

## On mainnet: co-signing offline

The CLI commands sign with `STELLAR_TESTNET_SECRET`, which is only available on
testnet. On mainnet:

1. Use the CLI to build and print the envelope (it will still build the XDR even
   though it cannot sign it on mainnet without a KMS signer).
2. Distribute the unsigned XDR to each required co-signer.
3. Each co-signer signs with their KMS/HSM and returns the envelope with their
   signature appended.
4. Aggregate the signatures (Stellar allows multiple `DecoratedSignature`
   entries on one envelope) and submit to Horizon.

## Emergency recovery

If all signers are lost (all private keys compromised or destroyed with no
backup) the account cannot be recovered through software. To prevent this:

- Keep at least three independent signers (N ≥ 3 with threshold 2).
- Store private key backups in at least two geographically separated HSMs.
- Run a quarterly rotation ceremony to exercise the process before it is
  needed under pressure.

## Quarterly rotation checklist

- [ ] Run `signer-list` and confirm the expected signers are present.
- [ ] Generate a new keypair offline (air-gapped machine or HSM).
- [ ] Run `signer-rotate <oldest-key> <new-key>` to build the envelope.
- [ ] Collect the co-signature from the second signer.
- [ ] Submit the envelope to Horizon.
- [ ] Run `signer-list` again and confirm the new key replaced the old one.
- [ ] Securely destroy the old private key material.
- [ ] Record the rotation in the audit log with the transaction hash and date.
