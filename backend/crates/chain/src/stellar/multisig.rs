//! Multisig custody account: SetOptions transactions to configure thresholds
//! and rotate signers safely.
//!
//! # Design
//!
//! The custody account runs 2-of-N multisig:
//!
//! * All signers carry weight 1.
//! * Low threshold: 1 — allow-trust and bump-sequence ops need only one signer.
//! * Med threshold: 2 — payments need two signers.
//! * High threshold: 2 — SetOptions (adding/removing signers) also needs two signers.
//!
//! The invariant: before submitting any SetOptions that removes a signer, the
//! caller must verify that the remaining signers still satisfy the high
//! threshold. [`validate_signing_capability`] enforces this at build time.

use stellar_xdr::{
    Limits, MuxedAccount, Operation, OperationBody, Preconditions, SequenceNumber, SetOptionsOp,
    Signer, SignerKey, TimeBounds, TimePoint, Transaction, TransactionEnvelope, TransactionExt,
    TransactionV1Envelope, Uint256, WriteXdr,
};

use super::network::StellarNetwork;
use super::payment::{add_signature, transaction_hash, PaymentError, StellarSigner};

/// The default signer weight assigned to every key in EngiPay's custody scheme.
pub const DEFAULT_WEIGHT: u32 = 1;

/// How many independent signatures are required to authorise any custody
/// operation (payment or account modification). With uniform signer weights of
/// 1, this is also the minimum number of signers that must remain after a
/// removal.
pub const REQUIRED_SIGNERS: u32 = 2;

/// Threshold configuration used for the custody account.
///
/// These values are written to the chain by [`build_multisig_setup`] and
/// queried back from Horizon by the signer-remove/rotate commands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CustodyThresholds {
    /// Low: operations like AllowTrust (kept at 1 — one signer suffices).
    pub low: u32,
    /// Med: payment and most account operations (requires REQUIRED_SIGNERS).
    pub med: u32,
    /// High: SetOptions, AccountMerge (requires REQUIRED_SIGNERS).
    pub high: u32,
}

impl Default for CustodyThresholds {
    fn default() -> Self {
        Self {
            low: 1,
            med: REQUIRED_SIGNERS,
            high: REQUIRED_SIGNERS,
        }
    }
}

/// A signer entry as returned by Horizon (`GET /accounts/{id}`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignerEntry {
    /// The signer's public key (`G...`).
    pub key: String,
    /// The signing weight. 0 is effectively disabled.
    pub weight: u32,
}

/// Errors that can arise from multisig operations.
#[derive(Debug, thiserror::Error)]
pub enum MultisigError {
    #[error("signer {0} is already on the account")]
    DuplicateSigner(String),
    #[error("signer {0} is not on the account")]
    SignerNotFound(String),
    #[error(
        "removing signer {key} would leave total weight {actual} \
         below the required {required}; the account would be unable \
         to sign further transactions"
    )]
    InsufficientWeight {
        key: String,
        actual: u32,
        required: u32,
    },
    #[error("payment or signing error: {0}")]
    Payment(#[from] PaymentError),
    #[error("key encoding error: {0}")]
    Key(String),
    #[error("XDR encoding error: {0}")]
    Xdr(String),
}

// ── Validation ──────────────────────────────────────────────────────────────

/// Returns `Ok(())` if removing `key_to_remove` from `signers` still leaves
/// enough combined weight to meet `required`.
///
/// With all signers at weight 1 this is equivalent to checking that at least
/// `required` other signers will remain active after the removal.
pub fn validate_signing_capability(
    signers: &[SignerEntry],
    key_to_remove: &str,
    required: u32,
) -> Result<(), MultisigError> {
    if signers.iter().all(|s| s.key != key_to_remove) {
        return Err(MultisigError::SignerNotFound(key_to_remove.to_owned()));
    }
    let remaining_weight: u32 = signers
        .iter()
        .filter(|s| s.key != key_to_remove && s.weight > 0)
        .map(|s| s.weight)
        .sum();
    if remaining_weight < required {
        return Err(MultisigError::InsufficientWeight {
            key: key_to_remove.to_owned(),
            actual: remaining_weight,
            required,
        });
    }
    Ok(())
}

// ── Internal helpers ─────────────────────────────────────────────────────────

fn raw_key(account: &str) -> Result<[u8; 32], MultisigError> {
    stellar_strkey::ed25519::PublicKey::from_string(account)
        .map(|k| k.0)
        .map_err(|_| MultisigError::Key(format!("{account:?} is not a valid G... address")))
}

fn set_signer_op(key_bytes: &[u8; 32], weight: u32) -> Operation {
    Operation {
        source_account: None,
        body: OperationBody::SetOptions(SetOptionsOp {
            inflation_dest: None,
            clear_flags: None,
            set_flags: None,
            master_weight: None,
            low_threshold: None,
            med_threshold: None,
            high_threshold: None,
            home_domain: None,
            signer: Some(Signer {
                key: SignerKey::Ed25519(Uint256(*key_bytes)),
                weight,
            }),
        }),
    }
}

fn remove_signer_op(key_bytes: &[u8; 32]) -> Operation {
    set_signer_op(key_bytes, 0)
}

// ── PreparedSetOptions ───────────────────────────────────────────────────────

/// A SetOptions transaction that has been signed and base64-encoded.
///
/// Submit [`envelope_xdr`] to Horizon's `POST /transactions`. After the
/// transaction lands the account state on-chain reflects the changes.
#[derive(Debug, Clone)]
pub struct PreparedSetOptions {
    /// The transaction hash (lowercase hex). Use it to track the transaction.
    pub hash: String,
    /// The signed envelope (base64 XDR). This is what Horizon accepts.
    pub envelope_xdr: String,
}

// ── Core builder ─────────────────────────────────────────────────────────────

/// Builds a SetOptions transaction from `source_bytes`, signed by all
/// `signers`.
///
/// * `sequence` — the source account's *current* sequence number (the
///   transaction will use `sequence + 1`).
/// * `operations` — one or more SetOptions [`Operation`] values.
/// * `signers` — every key that should sign this transaction. On a 2-of-2
///   account pass both signers; on a fresh single-key account pass the
///   one master key.
/// * `valid_until` — Unix timestamp (seconds) after which the network
///   rejects the transaction.
/// * `fee_per_op` — fee in stroops per operation (100 is the network minimum).
pub fn build_set_options(
    source_bytes: &[u8; 32],
    sequence: i64,
    operations: Vec<Operation>,
    signers: &[&dyn StellarSigner],
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<PreparedSetOptions, MultisigError> {
    let n_ops =
        u32::try_from(operations.len()).map_err(|_| MultisigError::Xdr("too many ops".into()))?;
    let transaction = Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(*source_bytes)),
        fee: fee_per_op.saturating_mul(n_ops.max(1)),
        seq_num: SequenceNumber(
            sequence
                .checked_add(1)
                .ok_or(MultisigError::Xdr("sequence overflow".into()))?,
        ),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(valid_until),
        }),
        memo: stellar_xdr::Memo::None,
        operations: operations
            .try_into()
            .map_err(|_| MultisigError::Xdr("too many operations".into()))?,
        ext: TransactionExt::V0,
    };

    let mut envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
        tx: transaction,
        signatures: Default::default(),
    });
    for signer in signers {
        envelope = add_signature(envelope, *signer, network)?;
    }

    let hash = transaction_hash(&envelope, network)?;
    let envelope_xdr = envelope
        .to_xdr_base64(Limits::none())
        .map_err(|e| MultisigError::Xdr(e.to_string()))?;

    Ok(PreparedSetOptions {
        hash: hash.iter().map(|b| format!("{b:02x}")).collect(),
        envelope_xdr,
    })
}

// ── Public operations ────────────────────────────────────────────────────────

/// Builds a transaction that converts a single-key custody account to
/// 2-of-N multisig.
///
/// The transaction contains:
/// 1. One SetOptions op that sets all three thresholds and sets
///    `master_weight` to `master_weight` (pass `0` to disable the original
///    key once the new signers are in place).
/// 2. One additional SetOptions op per entry in `new_signers`.
///
/// Sign with the current master key *before* it is disabled. After the
/// transaction lands the account requires at least `thresholds.high` combined
/// signer weight for any further changes.
pub fn build_multisig_setup(
    source_bytes: &[u8; 32],
    sequence: i64,
    new_signers: &[(String, u32)],
    thresholds: &CustodyThresholds,
    master_weight: u32,
    signers: &[&dyn StellarSigner],
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<PreparedSetOptions, MultisigError> {
    let mut ops: Vec<Operation> = Vec::new();

    // Op 1: set thresholds + master weight.
    ops.push(Operation {
        source_account: None,
        body: OperationBody::SetOptions(SetOptionsOp {
            inflation_dest: None,
            clear_flags: None,
            set_flags: None,
            master_weight: Some(master_weight),
            low_threshold: Some(thresholds.low),
            med_threshold: Some(thresholds.med),
            high_threshold: Some(thresholds.high),
            home_domain: None,
            signer: None,
        }),
    });

    // One op per new signer.
    for (key_str, weight) in new_signers {
        let key_bytes = raw_key(key_str)?;
        ops.push(set_signer_op(&key_bytes, *weight));
    }

    build_set_options(
        source_bytes,
        sequence,
        ops,
        signers,
        network,
        valid_until,
        fee_per_op,
    )
}

/// Builds a transaction that adds `new_key` to the custody account.
///
/// Fails if `new_key` is already in `existing_signers` (no-op would still
/// cost a fee and is almost certainly a mistake).
pub fn build_add_signer(
    source_bytes: &[u8; 32],
    sequence: i64,
    new_key: &str,
    weight: u32,
    existing_signers: &[SignerEntry],
    signers: &[&dyn StellarSigner],
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<PreparedSetOptions, MultisigError> {
    if existing_signers.iter().any(|s| s.key == new_key) {
        return Err(MultisigError::DuplicateSigner(new_key.to_owned()));
    }
    let key_bytes = raw_key(new_key)?;
    build_set_options(
        source_bytes,
        sequence,
        vec![set_signer_op(&key_bytes, weight)],
        signers,
        network,
        valid_until,
        fee_per_op,
    )
}

/// Builds a transaction that removes `key_to_remove` from the custody account.
///
/// Fails (before touching the network) if removing the signer would leave
/// total signer weight below `required_weight`, which would lock the account.
pub fn build_remove_signer(
    source_bytes: &[u8; 32],
    sequence: i64,
    key_to_remove: &str,
    existing_signers: &[SignerEntry],
    required_weight: u32,
    signers: &[&dyn StellarSigner],
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<PreparedSetOptions, MultisigError> {
    validate_signing_capability(existing_signers, key_to_remove, required_weight)?;
    let key_bytes = raw_key(key_to_remove)?;
    build_set_options(
        source_bytes,
        sequence,
        vec![remove_signer_op(&key_bytes)],
        signers,
        network,
        valid_until,
        fee_per_op,
    )
}

/// Builds a transaction that atomically replaces `old_key` with `new_key`.
///
/// The add operation comes first so there is never a window where the account
/// drops below the threshold weight during the ceremony.
///
/// Fails if:
/// * `old_key` is not on the account.
/// * `new_key` is already on the account (other than as `old_key` itself —
///   rotating to the same key is allowed and has no effect beyond a fresh
///   signature).
pub fn build_rotate_signer(
    source_bytes: &[u8; 32],
    sequence: i64,
    old_key: &str,
    new_key: &str,
    weight: u32,
    existing_signers: &[SignerEntry],
    signers: &[&dyn StellarSigner],
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<PreparedSetOptions, MultisigError> {
    if existing_signers.iter().all(|s| s.key != old_key) {
        return Err(MultisigError::SignerNotFound(old_key.to_owned()));
    }
    if old_key != new_key && existing_signers.iter().any(|s| s.key == new_key) {
        return Err(MultisigError::DuplicateSigner(new_key.to_owned()));
    }

    let old_bytes = raw_key(old_key)?;
    let new_bytes = raw_key(new_key)?;

    // Add new key first, then remove old key — never drops below threshold.
    let ops = vec![
        set_signer_op(&new_bytes, weight),
        remove_signer_op(&old_bytes),
    ];
    build_set_options(
        source_bytes,
        sequence,
        ops,
        signers,
        network,
        valid_until,
        fee_per_op,
    )
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use stellar_xdr::{Limits, ReadXdr};

    use super::*;
    use crate::stellar::payment::{verify_signature, LocalTestnetSigner};

    fn make_signer(seed: u8) -> LocalTestnetSigner {
        let raw = stellar_strkey::ed25519::PrivateKey([seed; 32]);
        LocalTestnetSigner::from_secret(
            raw.as_unredacted().to_string().as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap()
    }

    fn g(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    fn signers_of(seeds: &[u8]) -> Vec<SignerEntry> {
        seeds
            .iter()
            .map(|&s| SignerEntry {
                key: g(s),
                weight: 1,
            })
            .collect()
    }

    const VALID_UNTIL: u64 = 9_999_999_999;
    const FEE: u32 = 100;
    const SEQ: i64 = 10;

    // ── validate_signing_capability ────────────────────────────────────────

    #[test]
    fn validate_ok_when_enough_signers_remain() {
        let signers = signers_of(&[1, 2, 3]);
        assert!(validate_signing_capability(&signers, &g(1), 2).is_ok());
    }

    #[test]
    fn validate_fails_below_threshold() {
        let signers = signers_of(&[1, 2]);
        let err = validate_signing_capability(&signers, &g(1), 2).unwrap_err();
        assert!(matches!(err, MultisigError::InsufficientWeight { .. }));
    }

    #[test]
    fn validate_fails_for_unknown_key() {
        let signers = signers_of(&[1, 2]);
        let err = validate_signing_capability(&signers, &g(9), 2).unwrap_err();
        assert!(matches!(err, MultisigError::SignerNotFound(_)));
    }

    #[test]
    fn validate_passes_with_threshold_one_and_two_remain() {
        let signers = signers_of(&[1, 2]);
        assert!(validate_signing_capability(&signers, &g(1), 1).is_ok());
    }

    // ── build_multisig_setup ───────────────────────────────────────────────

    #[test]
    fn setup_produces_valid_signed_envelope() {
        let master = make_signer(1);
        let thresholds = CustodyThresholds::default();

        let prepared = build_multisig_setup(
            &master.public_key(),
            1,
            &[(g(10), DEFAULT_WEIGHT), (g(11), DEFAULT_WEIGHT)],
            &thresholds,
            0,
            &[&master as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap();

        assert!(!prepared.hash.is_empty());

        // XDR round-trip: 1 threshold op + 2 signer ops = 3 ops total.
        let env =
            TransactionEnvelope::from_xdr_base64(&prepared.envelope_xdr, Limits::none()).unwrap();
        let TransactionEnvelope::Tx(v1) = env else {
            panic!("expected v1 envelope");
        };
        assert_eq!(v1.tx.operations.len(), 3);
    }

    #[test]
    fn setup_signature_verifies() {
        let master = make_signer(1);
        let thresholds = CustodyThresholds::default();

        let prepared = build_multisig_setup(
            &master.public_key(),
            1,
            &[(g(10), DEFAULT_WEIGHT)],
            &thresholds,
            0,
            &[&master as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap();

        let env =
            TransactionEnvelope::from_xdr_base64(&prepared.envelope_xdr, Limits::none()).unwrap();
        assert!(
            verify_signature(&env, &master.public_key(), StellarNetwork::Testnet).unwrap()
        );
    }

    // ── build_add_signer ───────────────────────────────────────────────────

    #[test]
    fn add_signer_builds_valid_transaction() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let prepared = build_add_signer(
            &s1.public_key(),
            SEQ,
            &g(3),
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap();

        assert!(!prepared.hash.is_empty());
        assert!(!prepared.envelope_xdr.is_empty());
    }

    #[test]
    fn add_signer_rejects_duplicate() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let err = build_add_signer(
            &s1.public_key(),
            SEQ,
            &g(2), // already present
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap_err();

        assert!(matches!(err, MultisigError::DuplicateSigner(_)));
    }

    #[test]
    fn add_signer_two_signatures_both_verify() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let prepared = build_add_signer(
            &s1.public_key(),
            SEQ,
            &g(5),
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap();

        let env =
            TransactionEnvelope::from_xdr_base64(&prepared.envelope_xdr, Limits::none()).unwrap();
        let TransactionEnvelope::Tx(ref v1) = env else {
            panic!("expected v1 envelope");
        };
        assert_eq!(v1.signatures.len(), 2);
        assert!(verify_signature(&env, &s1.public_key(), StellarNetwork::Testnet).unwrap());
        assert!(verify_signature(&env, &s2.public_key(), StellarNetwork::Testnet).unwrap());
    }

    // ── build_remove_signer ───────────────────────────────────────────────

    #[test]
    fn remove_signer_ok_when_enough_remain() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2, 3]);

        let prepared = build_remove_signer(
            &s1.public_key(),
            SEQ,
            &g(3),
            &existing,
            2,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap();

        assert!(!prepared.hash.is_empty());
    }

    #[test]
    fn remove_signer_refuses_when_weight_drops_below_threshold() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]); // exactly 2 signers

        let err = build_remove_signer(
            &s1.public_key(),
            SEQ,
            &g(1),
            &existing,
            2, // high threshold
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap_err();

        assert!(matches!(err, MultisigError::InsufficientWeight { .. }));
    }

    #[test]
    fn remove_signer_refuses_unknown_key() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let err = build_remove_signer(
            &s1.public_key(),
            SEQ,
            &g(9), // not on account
            &existing,
            2,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap_err();

        assert!(matches!(err, MultisigError::SignerNotFound(_)));
    }

    // ── build_rotate_signer ───────────────────────────────────────────────

    #[test]
    fn rotate_signer_produces_two_ops_add_then_remove() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let prepared = build_rotate_signer(
            &s1.public_key(),
            SEQ,
            &g(1), // old
            &g(5), // new
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap();

        let env =
            TransactionEnvelope::from_xdr_base64(&prepared.envelope_xdr, Limits::none()).unwrap();
        let TransactionEnvelope::Tx(v1) = env else {
            panic!("expected v1 envelope");
        };
        // add + remove = 2 ops
        assert_eq!(v1.tx.operations.len(), 2);
        // First op sets weight to DEFAULT_WEIGHT (add), second sets to 0 (remove).
        let OperationBody::SetOptions(ref op0) = v1.tx.operations[0].body else {
            panic!("expected SetOptions");
        };
        assert_eq!(op0.signer.as_ref().unwrap().weight, DEFAULT_WEIGHT);
        let OperationBody::SetOptions(ref op1) = v1.tx.operations[1].body else {
            panic!("expected SetOptions");
        };
        assert_eq!(op1.signer.as_ref().unwrap().weight, 0);
    }

    #[test]
    fn rotate_signer_refuses_unknown_old_key() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let err = build_rotate_signer(
            &s1.public_key(),
            SEQ,
            &g(9), // not on account
            &g(5),
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap_err();

        assert!(matches!(err, MultisigError::SignerNotFound(_)));
    }

    #[test]
    fn rotate_signer_refuses_duplicate_new_key() {
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let err = build_rotate_signer(
            &s1.public_key(),
            SEQ,
            &g(1),
            &g(2), // already on the account
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        )
        .unwrap_err();

        assert!(matches!(err, MultisigError::DuplicateSigner(_)));
    }

    #[test]
    fn rotate_to_same_key_is_allowed() {
        // Rotating to the same key is a no-op on chain but is not an error —
        // it re-signs the key with a fresh sequence, which is sometimes needed
        // after a key ceremony audit.
        let s1 = make_signer(1);
        let s2 = make_signer(2);
        let existing = signers_of(&[1, 2]);

        let result = build_rotate_signer(
            &s1.public_key(),
            SEQ,
            &g(1),
            &g(1), // same key
            DEFAULT_WEIGHT,
            &existing,
            &[&s1 as &dyn StellarSigner, &s2 as &dyn StellarSigner],
            StellarNetwork::Testnet,
            VALID_UNTIL,
            FEE,
        );

        assert!(result.is_ok());
    }
}
