//! Building and signing Stellar payments.
//!
//! Transactions are built directly from the Stellar Development Foundation's
//! XDR definitions (`stellar-xdr`), so what EngiPay signs is exactly what the
//! network verifies.

use engipay_core::stellar::{StellarAddress, StellarAddressError, parse_address};
use engipay_core::{Asset, Chain, Money};
use stellar_xdr::{
    AccountId, AlphaNum4, AssetCode4, ClaimPredicate, Claimant, ClaimantV0,
    CreateClaimableBalanceOp, DecoratedSignature, Limits, Memo, MuxedAccount, MuxedAccountMed25519,
    Operation, OperationBody, PaymentOp, Preconditions, PublicKey, SequenceNumber, Signature,
    SignatureHint, StringM, TimeBounds, TimePoint, Transaction, TransactionEnvelope,
    TransactionExt, TransactionV1Envelope, Uint256, WriteXdr,
};
use zeroize::Zeroizing;

use super::network::StellarNetwork;

/// Base fee per operation, in stroops. 100 is the network minimum.
/// `build_payment` accepts an explicit fee so callers can pass a value from
/// Horizon's `/fee_stats` endpoint instead of this constant.
pub const BASE_FEE: u32 = 100;

/// Ceiling on the fee per operation taken from Horizon's fee stats, in
/// stroops (0.01 XLM). A surge above this waits for the next attempt rather
/// than paying whatever the market asks.
pub const MAX_FEE: u32 = 100_000;

/// Maximum length of a Stellar text memo, in bytes (protocol limit).
pub const MEMO_TEXT_MAX_BYTES: usize = 28;

#[derive(Debug, thiserror::Error)]
pub enum PaymentError {
    #[error("destination: {0}")]
    Destination(#[from] StellarAddressError),
    #[error("{0} cannot be sent on Stellar")]
    UnsupportedAsset(Asset),
    #[error("amount: {0}")]
    Amount(String),
    #[error("could not encode the transaction: {0}")]
    Encoding(String),
    #[error("signing key: {0}")]
    Key(&'static str),
    #[error("memo text exceeds {MEMO_TEXT_MAX_BYTES}-byte protocol limit")]
    MemoTooLong,
    #[error("slippage limit exceeded: quoted {quoted} {asset}, limit {limit}")]
    SlippageExceeded {
        quoted: String,
        limit: String,
        asset: Asset,
    },
    #[error("path payment: {0}")]
    PathPayment(String),
}

/// An optional memo attached to an outgoing Stellar transaction.
///
/// Stellar supports several memo types; EngiPay uses only the two that are
/// meaningful for payments:
///
/// * `Text` ΓÇö a UTF-8 string, at most 28 bytes (protocol limit).
/// * `Id` ΓÇö an unsigned 64-bit integer, commonly used by exchanges and anchors
///   to route a deposit to a specific account without a muxed address.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StellarMemo {
    /// A free-form text memo (Γëñ 28 bytes UTF-8).
    Text(String),
    /// A numeric ID memo (u64).
    Id(u64),
}

/// What to pay, before it is turned into a transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentRequest {
    pub destination: String,
    pub money: Money,
    /// Optional memo attached to the transaction on-chain.
    pub memo: Option<StellarMemo>,
    /// If true, create a claimable balance instead of a direct payment.
    /// Use this when the destination might not have a trustline for the asset.
    pub use_claimable_balance: bool,
}

/// Anything that can sign for a Stellar account: a local key in development,
/// a KMS or HSM in production. The private key never leaves the signer.
pub trait StellarSigner: Send + Sync {
    fn public_key(&self) -> [u8; 32];
    fn sign(&self, message: &[u8]) -> [u8; 64];

    fn account(&self) -> String {
        stellar_strkey::ed25519::PublicKey(self.public_key())
            .to_string()
            .as_str()
            .to_owned()
    }
}

/// A signing key held in memory. Refuses mainnet: real funds are signed by a
/// KMS or HSM, never by a key read from an environment variable.
pub struct LocalTestnetSigner {
    key: ed25519_dalek::SigningKey,
}

impl LocalTestnetSigner {
    pub fn from_secret(secret: &str, network: StellarNetwork) -> Result<Self, PaymentError> {
        if network != StellarNetwork::Testnet {
            return Err(PaymentError::Key(
                "local signing keys are only allowed on testnet",
            ));
        }
        let parsed = stellar_strkey::ed25519::PrivateKey::from_string(secret.trim())
            .map_err(|_| PaymentError::Key("not a valid Stellar secret key"))?;
        let seed = Zeroizing::new(parsed.0);
        Ok(Self {
            key: ed25519_dalek::SigningKey::from_bytes(&seed),
        })
    }
}

impl StellarSigner for LocalTestnetSigner {
    fn public_key(&self) -> [u8; 32] {
        self.key.verifying_key().to_bytes()
    }

    fn sign(&self, message: &[u8]) -> [u8; 64] {
        use ed25519_dalek::Signer;
        self.key.sign(message).to_bytes()
    }
}

impl std::fmt::Debug for LocalTestnetSigner {
    // Never print key material, even by accident in a log line.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalTestnetSigner")
            .field("account", &self.account())
            .finish_non_exhaustive()
    }
}

/// Backend for KMS or HSM signing operations.
///
/// Implementations must never expose the private key to process memory, only
/// return signatures. The signature is verified against the public key before
/// being sent to the network.
pub trait KmsBackend: Send + Sync {
    /// Signs the given message and returns the 64-byte Ed25519 signature.
    ///
    /// The implementation must call the KMS/HSM to sign the message without
    /// ever exposing the private key to this process.
    fn sign(&self, message: &[u8]) -> [u8; 64];
}

/// A KMS-backed signer that never exposes the private key to process memory.
///
/// The private key is held by a Key Management Service or Hardware Security
/// Module and only returns signatures. This is the production signing path.
pub struct KmsSigner {
    public_key: [u8; 32],
    backend: Box<dyn KmsBackend>,
}

impl KmsSigner {
    /// Creates a new KMS signer with the given public key and backend.
    ///
    /// The public key must match the key held by the KMS, but that is verified
    /// by checking the signature against the public key in `sign_withdrawal`.
    pub fn new(public_key: [u8; 32], backend: Box<dyn KmsBackend>) -> Self {
        Self {
            public_key,
            backend,
        }
    }
}

impl StellarSigner for KmsSigner {
    fn public_key(&self) -> [u8; 32] {
        self.public_key
    }

    fn sign(&self, message: &[u8]) -> [u8; 64] {
        self.backend.sign(message)
    }
}

impl std::fmt::Debug for KmsSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KmsSigner")
            .field("account", &self.account())
            .finish_non_exhaustive()
    }
}

/// The signer for the custody account that withdrawals are paid from.
///
/// Wraps any [`StellarSigner`] (a local key on testnet, a KMS or HSM in
/// production) and binds it to the configured custody account, so a
/// misconfigured key is refused at startup instead of producing transactions
/// the network would reject, or worse, signing for the wrong account.
pub struct CustodySigner<S> {
    inner: S,
}

impl<S: StellarSigner> CustodySigner<S> {
    /// Binds `inner` to `custody_account` (`G...`). Fails if the key does not
    /// control that account.
    pub fn new(inner: S, custody_account: &str) -> Result<Self, PaymentError> {
        let custody = stellar_strkey::ed25519::PublicKey::from_string(custody_account)
            .map_err(|_| PaymentError::Key("the custody account is not a G... address"))?;
        if custody.0 != inner.public_key() {
            return Err(PaymentError::Key(
                "the signing key does not control the custody account",
            ));
        }
        Ok(Self { inner })
    }
}

impl<S: StellarSigner> StellarSigner for CustodySigner<S> {
    fn public_key(&self) -> [u8; 32] {
        self.inner.public_key()
    }

    fn sign(&self, message: &[u8]) -> [u8; 64] {
        self.inner.sign(message)
    }
}

impl<S: StellarSigner> std::fmt::Debug for CustodySigner<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CustodySigner")
            .field("account", &self.account())
            .finish_non_exhaustive()
    }
}

/// Builds an unsigned payment transaction.
///
/// * `source` ΓÇö the ed25519 public key bytes of the signing account.
/// * `sequence` ΓÇö the source account's *current* sequence number; the
///   transaction uses `sequence + 1`.
/// * `request` ΓÇö what to pay and the optional on-chain memo.
/// * `network` ΓÇö testnet or mainnet (affects the USDC issuer and the network
///   hash used for signing).
/// * `valid_until` ΓÇö Unix timestamp after which the network will reject the
///   transaction, so a stuck payment cannot land hours later.
/// * `fee_per_op` ΓÇö base fee in stroops per operation. Pass [`BASE_FEE`] for
///   the network minimum, or a value from Horizon's `/fee_stats` endpoint
///   (e.g. `p90_accepted_fee`) under load.
///
/// If `request.use_claimable_balance` is true, creates a claimable balance
/// instead of a direct payment. This allows sending to accounts that don't
/// have a trustline for the asset yet.
pub fn build_payment(
    source: &[u8; 32],
    sequence: i64,
    request: &PaymentRequest,
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<Transaction, PaymentError> {
    let destination = parse_destination(&request.destination)?;
    let asset = xdr_asset(request.money.asset, network)?;

    let units = request
        .money
        .to_network_units(Chain::Stellar)
        .map_err(|error| PaymentError::Amount(error.to_string()))?;
    if units <= 0 {
        return Err(PaymentError::Amount("must be greater than zero".to_owned()));
    }
    let amount = i64::try_from(units)
        .map_err(|_| PaymentError::Amount("too large for Stellar".to_owned()))?;

    let next_sequence = sequence
        .checked_add(1)
        .ok_or(PaymentError::Amount("sequence number overflow".to_owned()))?;

    let memo = memo_xdr(request.memo.as_ref())?;

    let operation = if request.use_claimable_balance {
        // Create a claimable balance that only the destination can claim.
        // The predicate is unconditional, so they can claim it anytime.
        let claimants = vec![Claimant::ClaimantTypeV0(ClaimantV0 {
            destination: destination.clone(),
            predicate: ClaimPredicate::Unconditional,
        })];
        Operation {
            source_account: None,
            body: OperationBody::CreateClaimableBalance(CreateClaimableBalanceOp {
                asset,
                amount,
                claimants: claimants
                    .try_into()
                    .map_err(|_| PaymentError::Encoding("too many claimants".to_owned()))?,
            }),
        }
    } else {
        // Direct payment to the destination account.
        let muxed_dest = match parse_address(&request.destination)? {
            StellarAddress::Account(account) => MuxedAccount::Ed25519(Uint256(raw_key(&account)?)),
            StellarAddress::Muxed { base, id } => {
                MuxedAccount::MuxedEd25519(MuxedAccountMed25519 {
                    id,
                    ed25519: Uint256(raw_key(&base)?),
                })
            }
        };
        Operation {
            source_account: None,
            body: OperationBody::Payment(PaymentOp {
                destination: muxed_dest,
                asset,
                amount,
            }),
        }
    };

    Ok(Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(*source)),
        fee: fee_per_op,
        seq_num: SequenceNumber(next_sequence),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(valid_until),
        }),
        memo,
        operations: vec![operation]
            .try_into()
            .map_err(|_| PaymentError::Encoding("too many operations".to_owned()))?,
        ext: TransactionExt::V0,
    })
}

/// A path payment quote returned by Horizon's `/paths` endpoint.
///
/// `path` is the intermediate assets the payment hops through (excluding the
/// source and destination assets). `destination_amount` is what the
/// destination would receive for the quoted send amount (strict-send), or what
/// the source must send for the quoted destination amount (strict-receive).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathQuote {
    /// Intermediate assets, in hop order, as `(asset, issuer)` pairs.
    pub path: Vec<PathAsset>,
    /// The amount the destination receives (strict-send) or the source sends
    /// (strict-receive), in network units (stroops).
    pub destination_amount: i64,
}

/// An asset on a path, as returned by Horizon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathAsset {
    Native,
    Credit { code: String, issuer: String },
}

/// A slippage limit the user agreed to, expressed in basis points (1 bps =
/// 0.01%). The quoted amount must be within this tolerance of the amount the
/// user expects, otherwise the payment is refused before it is built.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlippageLimit {
    /// Maximum acceptable slippage, in basis points. 50 = 0.5%.
    pub bps: u32,
}

impl SlippageLimit {
    /// The minimum acceptable destination amount for a strict-send payment
    /// that expects `expected` units, after applying the slippage tolerance.
    pub fn min_destination(&self, expected: i64) -> i64 {
        let tolerance = (i128::from(expected) * i128::from(self.bps)) / 10_000;
        let min = i128::from(expected) - tolerance;
        i64::try_from(min.max(0)).unwrap_or(i64::MAX)
    }

    /// The maximum acceptable source amount for a strict-receive payment that
    /// expects to spend `expected` units, after applying the tolerance.
    pub fn max_source(&self, expected: i64) -> i64 {
        let tolerance = (i128::from(expected) * i128::from(self.bps)) / 10_000;
        let max = i128::from(expected) + tolerance;
        i64::try_from(max).unwrap_or(i64::MAX)
    }
}

/// Builds a strict-send path payment: the source sends exactly `send_amount`
/// of `send_asset`, and the destination receives at least `dest_min` of
/// `dest_asset` along `path`.
///
/// `quote` is the Horizon path quote for `send_amount`. The quoted destination
/// amount must satisfy the user's `slippage` limit relative to
/// `expected_destination`; otherwise [`PaymentError::SlippageExceeded`] is
/// returned and no transaction is built.
#[allow(clippy::too_many_arguments)]
pub fn build_path_payment_strict_send(
    source: &[u8; 32],
    sequence: i64,
    destination: &str,
    send_asset: Asset,
    send_amount: Money,
    dest_asset: Asset,
    expected_destination: Money,
    quote: &PathQuote,
    slippage: SlippageLimit,
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<Transaction, PaymentError> {
    let send_units = network_units(send_amount)?;
    let expected_units = network_units(expected_destination)?;

    // The quote must meet the user's slippage limit before we build anything.
    let min_dest = slippage.min_destination(expected_units);
    if quote.destination_amount < min_dest {
        return Err(PaymentError::SlippageExceeded {
            quoted: quote.destination_amount.to_string(),
            limit: min_dest.to_string(),
            asset: dest_asset,
        });
    }

    let dest_min = i64::try_from(min_dest)
        .map_err(|_| PaymentError::Amount("too large for Stellar".to_owned()))?;

    let operation = Operation {
        source_account: None,
        body: OperationBody::PathPaymentStrictSend(
            stellar_xdr::PathPaymentStrictSendOp {
                send_asset: xdr_asset(send_asset, network)?,
                send_amount: send_units,
                destination: muxed_account(destination)?,
                dest_asset: xdr_asset(dest_asset, network)?,
                dest_min,
                path: path_xdr(&quote.path, network)?,
            },
        ),
    };

    build_single_operation(source, sequence, operation, network, valid_until, fee_per_op)
}

/// Builds a strict-receive path payment: the destination receives exactly
/// `dest_amount` of `dest_asset`, and the source sends at most `send_max` of
/// `send_asset` along `path`.
///
/// `quote` is the Horizon path quote for `dest_amount`. The quoted source
/// amount must satisfy the user's `slippage` limit relative to
/// `expected_source`; otherwise [`PaymentError::SlippageExceeded`] is
/// returned and no transaction is built.
#[allow(clippy::too_many_arguments)]
pub fn build_path_payment_strict_receive(
    source: &[u8; 32],
    sequence: i64,
    destination: &str,
    send_asset: Asset,
    expected_source: Money,
    dest_asset: Asset,
    dest_amount: Money,
    quote: &PathQuote,
    slippage: SlippageLimit,
    network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<Transaction, PaymentError> {
    let dest_units = network_units(dest_amount)?;
    let expected_units = network_units(expected_source)?;

    // The quote must meet the user's slippage limit before we build anything.
    let max_send = slippage.max_source(expected_units);
    if quote.destination_amount > max_send {
        return Err(PaymentError::SlippageExceeded {
            quoted: quote.destination_amount.to_string(),
            limit: max_send.to_string(),
            asset: send_asset,
        });
    }

    let send_max = i64::try_from(max_send)
        .map_err(|_| PaymentError::Amount("too large for Stellar".to_owned()))?;

    let operation = Operation {
        source_account: None,
        body: OperationBody::PathPaymentStrictReceive(
            stellar_xdr::PathPaymentStrictReceiveOp {
                send_asset: xdr_asset(send_asset, network)?,
                send_max,
                destination: muxed_account(destination)?,
                dest_asset: xdr_asset(dest_asset, network)?,
                dest_amount: dest_units,
                path: path_xdr(&quote.path, network)?,
            },
        ),
    };

    build_single_operation(source, sequence, operation, network, valid_until, fee_per_op)
}

/// Converts a [`Money`] into Stellar network units, refusing non-positive
/// amounts.
fn network_units(money: Money) -> Result<i64, PaymentError> {
    let units = money
        .to_network_units(Chain::Stellar)
        .map_err(|error| PaymentError::Amount(error.to_string()))?;
    if units <= 0 {
        return Err(PaymentError::Amount("must be greater than zero".to_owned()));
    }
    i64::try_from(units).map_err(|_| PaymentError::Amount("too large for Stellar".to_owned()))
}

/// Converts the Horizon path into the XDR path vector.
fn path_xdr(
    path: &[PathAsset],
    network: StellarNetwork,
) -> Result<Vec<stellar_xdr::Asset>, PaymentError> {
    path.iter()
        .map(|asset| match asset {
            PathAsset::Native => Ok(stellar_xdr::Asset::Native),
            PathAsset::Credit { code, issuer } => {
                let bytes = code.as_bytes();
                if bytes.len() != 4 {
                    return Err(PaymentError::PathPayment(format!(
                        "asset code {code:?} is not 4 bytes"
                    )));
                }
                let mut asset_code = [0u8; 4];
                asset_code.copy_from_slice(bytes);
                Ok(stellar_xdr::Asset::CreditAlphanum4(AlphaNum4 {
                    asset_code: AssetCode4(asset_code),
                    issuer: AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(raw_key(
                        issuer,
                    )?))),
                }))
            }
        })
        .collect()
}

/// Wraps a single operation in a time-bounded transaction.
fn build_single_operation(
    source: &[u8; 32],
    sequence: i64,
    operation: Operation,
    _network: StellarNetwork,
    valid_until: u64,
    fee_per_op: u32,
) -> Result<Transaction, PaymentError> {
    let next_sequence = sequence
        .checked_add(1)
        .ok_or(PaymentError::Amount("sequence number overflow".to_owned()))?;
    Ok(Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(*source)),
        fee: fee_per_op,
        seq_num: SequenceNumber(next_sequence),
        cond: Preconditions::Time(TimeBounds {
            min_time: TimePoint(0),
            max_time: TimePoint(valid_until),
        }),
        memo: Memo::None,
        operations: vec![operation]
            .try_into()
            .map_err(|_| PaymentError::Encoding("too many operations".to_owned()))?,
        ext: TransactionExt::V0,
    })
}

/// Parses the destination address into an AccountId for claimable balances.
/// This is separate from muxed_account because claimable balances use AccountId.
fn parse_destination(address: &str) -> Result<AccountId, PaymentError> {
    let parsed = parse_address(address)?;
    let account = match parsed {
        StellarAddress::Account(acc) => acc,
        StellarAddress::Muxed { base, .. } => base,
    };
    Ok(AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(
        raw_key(&account)?,
    ))))
}

/// Converts the optional [`StellarMemo`] into the XDR `Memo` type.
fn memo_xdr(memo: Option<&StellarMemo>) -> Result<Memo, PaymentError> {
    match memo {
        None => Ok(Memo::None),
        Some(StellarMemo::Id(id)) => Ok(Memo::Id(*id)),
        Some(StellarMemo::Text(text)) => {
            let bytes = text.as_bytes();
            if bytes.len() > MEMO_TEXT_MAX_BYTES {
                return Err(PaymentError::MemoTooLong);
            }
            Ok(Memo::Text(
                StringM::<28>::try_from(bytes.to_vec())
                    .map_err(|_| PaymentError::Encoding("memo text encoding".to_owned()))?,
            ))
        }
    }
}

/// Signs a transaction for `network` and returns the envelope and its hash.
pub fn sign(
    transaction: Transaction,
    signer: &dyn StellarSigner,
    network: StellarNetwork,
) -> Result<(TransactionEnvelope, [u8; 32]), PaymentError> {
    let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
        tx: transaction,
        signatures: Default::default(),
    });
    let envelope = add_signature(envelope, signer, network)?;
    let hash = transaction_hash(&envelope, network)?;
    Ok((envelope, hash))
}

/// Signs a withdrawal paid from the custody account.
///
/// Refuses a transaction whose source is not the custody account, so the
/// custody key can never be used to authorise someone else's transaction, and
/// verifies the signature against the custody public key before returning it:
/// a faulty signer (a misbehaving HSM, a key mix-up) fails here, not on the
/// network.
pub fn sign_withdrawal<S: StellarSigner>(
    transaction: Transaction,
    custody: &CustodySigner<S>,
    network: StellarNetwork,
) -> Result<(TransactionEnvelope, [u8; 32]), PaymentError> {
    if transaction.source_account != MuxedAccount::Ed25519(Uint256(custody.public_key())) {
        return Err(PaymentError::Key(
            "the transaction is not paid from the custody account",
        ));
    }
    let (envelope, hash) = sign(transaction, custody, network)?;
    if !verify_signature(&envelope, &custody.public_key(), network)? {
        return Err(PaymentError::Key(
            "the signature does not verify against the custody key",
        ));
    }
    Ok((envelope, hash))
}

/// Attaches `signer`'s decorated signature to `envelope`, keeping any
/// signatures already on it (for accounts that need more than one signer).
pub fn add_signature(
    envelope: TransactionEnvelope,
    signer: &dyn StellarSigner,
    network: StellarNetwork,
) -> Result<TransactionEnvelope, PaymentError> {
    let hash = transaction_hash(&envelope, network)?;
    let TransactionEnvelope::Tx(mut v1) = envelope else {
        return Err(PaymentError::Encoding(
            "only v1 transaction envelopes can be signed".to_owned(),
        ));
    };
    let signature = DecoratedSignature {
        hint: signature_hint(&signer.public_key()),
        signature: Signature(
            signer
                .sign(&hash)
                .to_vec()
                .try_into()
                .map_err(|_| PaymentError::Encoding("signature length".to_owned()))?,
        ),
    };
    let mut signatures = v1.signatures.to_vec();
    signatures.push(signature);
    v1.signatures = signatures
        .try_into()
        .map_err(|_| PaymentError::Encoding("too many signatures".to_owned()))?;
    Ok(TransactionEnvelope::Tx(v1))
}

/// Whether `envelope` carries a valid signature by `public_key` for
/// `network`. Only signatures whose hint matches the key are checked.
pub fn verify_signature(
    envelope: &TransactionEnvelope,
    public_key: &[u8; 32],
    network: StellarNetwork,
) -> Result<bool, PaymentError> {
    let TransactionEnvelope::Tx(v1) = envelope else {
        return Ok(false);
    };
    let hash = transaction_hash(envelope, network)?;
    let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(public_key) else {
        return Ok(false);
    };
    let hint = signature_hint(public_key);
    Ok(v1
        .signatures
        .iter()
        .filter(|decorated| decorated.hint == hint)
        .any(|decorated| {
            ed25519_dalek::Signature::from_slice(decorated.signature.0.as_slice())
                .is_ok_and(|signature| key.verify_strict(&hash, &signature).is_ok())
        }))
}

/// The hash the network signs: SHA-256 of the network ID and the transaction.
pub fn transaction_hash(
    envelope: &TransactionEnvelope,
    network: StellarNetwork,
) -> Result<[u8; 32], PaymentError> {
    let TransactionEnvelope::Tx(v1) = envelope else {
        return Err(PaymentError::Encoding(
            "only v1 transaction envelopes are supported".to_owned(),
        ));
    };
    v1.tx
        .hash(network.network_id())
        .map_err(|error| PaymentError::Encoding(error.to_string()))
}

/// The last four bytes of the public key, which tell the network which signer
/// a signature belongs to.
pub fn signature_hint(public_key: &[u8; 32]) -> SignatureHint {
    SignatureHint([
        public_key[28],
        public_key[29],
        public_key[30],
        public_key[31],
    ])
}

/// The base64 XDR Horizon accepts on `POST /transactions`.
pub fn envelope_base64(envelope: &TransactionEnvelope) -> Result<String, PaymentError> {
    envelope
        .to_xdr_base64(Limits::none())
        .map_err(|error| PaymentError::Encoding(error.to_string()))
}

fn muxed_account(address: &str) -> Result<MuxedAccount, PaymentError> {
    Ok(match parse_address(address)? {
        StellarAddress::Account(account) => MuxedAccount::Ed25519(Uint256(raw_key(&account)?)),
        StellarAddress::Muxed { base, id } => MuxedAccount::MuxedEd25519(MuxedAccountMed25519 {
            id,
            ed25519: Uint256(raw_key(&base)?),
        }),
    })
}

fn raw_key(account: &str) -> Result<[u8; 32], PaymentError> {
    stellar_strkey::ed25519::PublicKey::from_string(account)
        .map(|key| key.0)
        .map_err(|_| PaymentError::Destination(StellarAddressError::Invalid))
}

fn xdr_asset(asset: Asset, network: StellarNetwork) -> Result<stellar_xdr::Asset, PaymentError> {
    match asset {
        Asset::Xlm => Ok(stellar_xdr::Asset::Native),
        Asset::Usdc => Ok(stellar_xdr::Asset::CreditAlphanum4(AlphaNum4 {
            asset_code: AssetCode4(*b"USDC"),
            issuer: AccountId(PublicKey::PublicKeyTypeEd25519(Uint256(raw_key(
                network.usdc_issuer(),
            )?))),
        })),
        other => Err(PaymentError::UnsupportedAsset(other)),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use ed25519_dalek::{Verifier, VerifyingKey};
    use stellar_xdr::ReadXdr;

    /// A fake KMS backend for testing that wraps a real key.
    ///
    /// This is only used in tests to verify the KMS signer trait works correctly.
    /// Real production implementations would call out to AWS KMS, Azure Key Vault,
    /// Google Cloud KMS, or a hardware security module.
    struct FakeKmsBackend {
        key: ed25519_dalek::SigningKey,
    }

    impl FakeKmsBackend {
        fn new(seed: [u8; 32]) -> Self {
            Self {
                key: ed25519_dalek::SigningKey::from_bytes(&seed),
            }
        }
    }

    impl KmsBackend for FakeKmsBackend {
        fn sign(&self, message: &[u8]) -> [u8; 64] {
            use ed25519_dalek::Signer;
            self.key.sign(message).to_bytes()
        }
    }

    fn signer() -> LocalTestnetSigner {
        let secret = stellar_strkey::ed25519::PrivateKey([7; 32]);
        LocalTestnetSigner::from_secret(
            secret.as_unredacted().to_string().as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap()
    }

    fn kms_signer() -> KmsSigner {
        let seed = [9; 32];
        let signing_key = ed25519_dalek::SigningKey::from_bytes(&seed);
        let public_key = signing_key.verifying_key().to_bytes();
        let backend = Box::new(FakeKmsBackend::new(seed));
        KmsSigner::new(public_key, backend)
    }

    fn account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    fn request(destination: String, asset: Asset, amount: &str) -> PaymentRequest {
        PaymentRequest {
            destination,
            money: Money::parse(asset, amount).unwrap(),
            memo: None,
            use_claimable_balance: false,
        }
    }

    #[test]
    fn local_keys_are_refused_on_mainnet() {
        let secret = stellar_strkey::ed25519::PrivateKey([7; 32]);
        let refused = LocalTestnetSigner::from_secret(
            secret.as_unredacted().to_string().as_str(),
            StellarNetwork::Mainnet,
        );
        assert!(matches!(refused, Err(PaymentError::Key(_))));
    }

    #[test]
    fn debug_output_never_contains_the_secret() {
        let secret = stellar_strkey::ed25519::PrivateKey([7; 32]);
        let text = format!("{:?}", signer());
        assert!(!text.contains(secret.as_unredacted().to_string().as_str()));
        assert!(text.contains(&signer().account()));
    }

    #[test]
    fn builds_a_native_payment_with_the_next_sequence() {
        let tx = build_payment(
            &signer().public_key(),
            41,
            &request(account(2), Asset::Xlm, "1.5"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        assert_eq!(tx.seq_num, SequenceNumber(42));
        assert_eq!(tx.fee, BASE_FEE);
        let OperationBody::Payment(payment) = &tx.operations[0].body else {
            panic!("not a payment");
        };
        assert_eq!(payment.amount, 15_000_000);
        assert_eq!(payment.asset, stellar_xdr::Asset::Native);
    }

    #[test]
    fn pays_a_muxed_address_with_its_id() {
        let custody = account(9);
        let muxed = engipay_core::stellar::muxed_deposit_address(&custody, 777).unwrap();
        let tx = build_payment(
            &signer().public_key(),
            1,
            &request(muxed, Asset::Usdc, "2"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let OperationBody::Payment(payment) = &tx.operations[0].body else {
            panic!("not a payment");
        };
        assert_eq!(
            payment.destination,
            MuxedAccount::MuxedEd25519(MuxedAccountMed25519 {
                id: 777,
                ed25519: Uint256([9; 32]),
            })
        );
        assert!(matches!(
            payment.asset,
            stellar_xdr::Asset::CreditAlphanum4(_)
        ));
    }

    #[test]
    fn refuses_assets_that_are_not_on_stellar() {
        let refused = build_payment(
            &signer().public_key(),
            1,
            &request(account(2), Asset::Btc, "0.1"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(matches!(
            refused,
            Err(PaymentError::UnsupportedAsset(Asset::Btc))
        ));
    }

    #[test]
    fn refuses_zero_and_bad_destinations() {
        let zero = build_payment(
            &signer().public_key(),
            1,
            &request(account(2), Asset::Xlm, "0"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(matches!(zero, Err(PaymentError::Amount(_))));

        let evm = build_payment(
            &signer().public_key(),
            1,
            &request(
                "0x1234567890abcdef1234567890abcdef12345678".to_owned(),
                Asset::Xlm,
                "1",
            ),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(matches!(evm, Err(PaymentError::Destination(_))));
    }

    #[test]
    fn the_signature_verifies_against_the_network_hash() {
        let signer = signer();
        let tx = build_payment(
            &signer.public_key(),
            1,
            &request(account(2), Asset::Xlm, "3"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let (envelope, hash) = sign(tx, &signer, StellarNetwork::Testnet).unwrap();

        let TransactionEnvelope::Tx(v1) = &envelope else {
            panic!("not a v1 envelope");
        };
        let verifying = VerifyingKey::from_bytes(&signer.public_key()).unwrap();
        let signature =
            ed25519_dalek::Signature::from_slice(v1.signatures[0].signature.0.as_slice()).unwrap();
        assert!(verifying.verify(&hash, &signature).is_ok());

        // Signed for testnet, so the mainnet hash differs and would not verify.
        let mainnet_hash = v1.tx.hash(StellarNetwork::Mainnet.network_id()).unwrap();
        assert!(verifying.verify(&mainnet_hash, &signature).is_err());
    }

    #[test]
    fn the_envelope_round_trips_through_base64() {
        let signer = signer();
        let tx = build_payment(
            &signer.public_key(),
            5,
            &request(account(2), Asset::Xlm, "0.0000001"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let (envelope, _) = sign(tx, &signer, StellarNetwork::Testnet).unwrap();
        let encoded = envelope_base64(&envelope).unwrap();
        let decoded = TransactionEnvelope::from_xdr_base64(&encoded, Limits::none()).unwrap();
        assert_eq!(decoded, envelope);
    }

    // ΓöÇΓöÇ Memo tests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    #[test]
    fn text_memo_is_encoded_in_the_xdr() {
        let mut req = request(account(2), Asset::Xlm, "1");
        req.memo = Some(StellarMemo::Text("hello engipay".to_owned()));
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let Memo::Text(text) = tx.memo else {
            panic!("expected text memo");
        };
        assert_eq!(text.as_slice(), b"hello engipay");
    }

    #[test]
    fn id_memo_is_encoded_in_the_xdr() {
        let mut req = request(account(2), Asset::Xlm, "1");
        req.memo = Some(StellarMemo::Id(42_000));
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        assert_eq!(tx.memo, Memo::Id(42_000));
    }

    #[test]
    fn no_memo_produces_memo_none() {
        let req = request(account(2), Asset::Xlm, "1");
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        assert_eq!(tx.memo, Memo::None);
    }

    #[test]
    fn text_memo_at_exactly_28_bytes_is_accepted() {
        let text = "a".repeat(MEMO_TEXT_MAX_BYTES);
        let mut req = request(account(2), Asset::Xlm, "1");
        req.memo = Some(StellarMemo::Text(text));
        let result = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn text_memo_over_28_bytes_is_rejected() {
        let too_long = "a".repeat(MEMO_TEXT_MAX_BYTES + 1);
        let mut req = request(account(2), Asset::Xlm, "1");
        req.memo = Some(StellarMemo::Text(too_long));
        let result = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(matches!(result, Err(PaymentError::MemoTooLong)));
    }

    #[test]
    fn custom_fee_per_op_is_set_on_the_transaction() {
        let tx = build_payment(
            &signer().public_key(),
            1,
            &request(account(2), Asset::Xlm, "1"),
            StellarNetwork::Testnet,
            1_800_000_000,
            500, // 5x the minimum
        )
        .unwrap();
        assert_eq!(tx.fee, 500);
    }

    #[test]
    fn memo_and_custom_fee_survive_base64_round_trip() {
        let signer = signer();
        let mut req = request(account(2), Asset::Xlm, "2");
        req.memo = Some(StellarMemo::Text("round-trip test".to_owned()));
        let tx = build_payment(
            &signer.public_key(),
            3,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            250,
        )
        .unwrap();
        let (envelope, _) = sign(tx, &signer, StellarNetwork::Testnet).unwrap();
        let encoded = envelope_base64(&envelope).unwrap();
        let decoded = TransactionEnvelope::from_xdr_base64(&encoded, Limits::none()).unwrap();
        assert_eq!(decoded, envelope);
        let TransactionEnvelope::Tx(v1) = decoded else {
            panic!("not a v1 envelope");
        };
        assert_eq!(v1.tx.fee, 250);
        let Memo::Text(text) = v1.tx.memo else {
            panic!("expected text memo");
        };
        assert_eq!(text.as_slice(), b"round-trip test");
    }

    // ΓöÇΓöÇ KMS signer tests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    #[test]
    fn kms_signer_produces_valid_signatures() {
        let kms = kms_signer();
        let tx = build_payment(
            &kms.public_key(),
            1,
            &request(account(2), Asset::Xlm, "3"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let (envelope, hash) = sign(tx, &kms, StellarNetwork::Testnet).unwrap();

        // Verify the signature against the public key.
        let TransactionEnvelope::Tx(v1) = &envelope else {
            panic!("not a v1 envelope");
        };
        let verifying = VerifyingKey::from_bytes(&kms.public_key()).unwrap();
        let signature =
            ed25519_dalek::Signature::from_slice(v1.signatures[0].signature.0.as_slice()).unwrap();
        assert!(verifying.verify(&hash, &signature).is_ok());
    }

    #[test]
    fn kms_signer_works_with_custody_wrapper() {
        let kms = kms_signer();
        let account_g = stellar_strkey::ed25519::PublicKey(kms.public_key())
            .to_string()
            .as_str()
            .to_owned();
        let custody = CustodySigner::new(kms, &account_g).unwrap();

        let tx = build_payment(
            &custody.public_key(),
            5,
            &request(account(3), Asset::Usdc, "10.50"),
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();

        let (envelope, _) = sign_withdrawal(tx, &custody, StellarNetwork::Testnet).unwrap();

        // The signature should verify against the custody key.
        assert!(
            verify_signature(&envelope, &custody.public_key(), StellarNetwork::Testnet).unwrap()
        );
    }

    #[test]
    fn kms_signer_can_be_used_on_mainnet() {
        // Unlike LocalTestnetSigner, KMS signers work on any network.
        let kms = kms_signer();
        let tx = build_payment(
            &kms.public_key(),
            1,
            &request(account(2), Asset::Xlm, "1"),
            StellarNetwork::Mainnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let result = sign(tx, &kms, StellarNetwork::Mainnet);
        assert!(result.is_ok());
    }

    #[test]
    fn local_testnet_signer_still_refuses_mainnet() {
        // Verify that the testnet-only restriction on LocalTestnetSigner is untouched.
        let secret = stellar_strkey::ed25519::PrivateKey([7; 32]);
        let refused = LocalTestnetSigner::from_secret(
            secret.as_unredacted().to_string().as_str(),
            StellarNetwork::Mainnet,
        );
        assert!(matches!(refused, Err(PaymentError::Key(_))));
    }

    // ΓöÇΓöÇ Claimable balance tests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    #[test]
    fn creates_claimable_balance_when_requested() {
        let mut req = request(account(2), Asset::Xlm, "5");
        req.use_claimable_balance = true;
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();

        // Should be a CreateClaimableBalance operation, not a Payment.
        let OperationBody::CreateClaimableBalance(op) = &tx.operations[0].body else {
            panic!("expected CreateClaimableBalance operation");
        };
        assert_eq!(op.amount, 50_000_000); // 5 XLM in stroops
        assert_eq!(op.asset, stellar_xdr::Asset::Native);
        assert_eq!(op.claimants.len(), 1);

        // Verify the claimant is the destination.
        let Claimant::ClaimantTypeV0(claimant) = &op.claimants[0];
        assert_eq!(
            claimant.destination,
            AccountId(PublicKey::PublicKeyTypeEd25519(Uint256([2; 32])))
        );
        assert_eq!(claimant.predicate, ClaimPredicate::Unconditional);
    }

    #[test]
    fn claimable_balance_works_with_usdc() {
        let mut req = request(account(3), Asset::Usdc, "100");
        req.use_claimable_balance = true;
        let tx = build_payment(
            &signer().public_key(),
            10,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();

        let OperationBody::CreateClaimableBalance(op) = &tx.operations[0].body else {
            panic!("expected CreateClaimableBalance operation");
        };
        assert_eq!(op.amount, 1_000_000_000); // 100 USDC (7 decimals)
        assert!(matches!(op.asset, stellar_xdr::Asset::CreditAlphanum4(_)));
    }

    #[test]
    fn claimable_balance_works_with_muxed_address() {
        let custody = account(9);
        let muxed = engipay_core::stellar::muxed_deposit_address(&custody, 777).unwrap();
        let mut req = request(muxed, Asset::Xlm, "2");
        req.use_claimable_balance = true;
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();

        let OperationBody::CreateClaimableBalance(op) = &tx.operations[0].body else {
            panic!("expected CreateClaimableBalance operation");
        };
        // Should extract the base G... address, not the M... address.
        let Claimant::ClaimantTypeV0(claimant) = &op.claimants[0];
        assert_eq!(
            claimant.destination,
            AccountId(PublicKey::PublicKeyTypeEd25519(Uint256([9; 32])))
        );
    }

    #[test]
    fn claimable_balance_can_be_signed_and_encoded() {
        let signer = signer();
        let mut req = request(account(4), Asset::Xlm, "10");
        req.use_claimable_balance = true;
        let tx = build_payment(
            &signer.public_key(),
            5,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let (envelope, _) = sign(tx, &signer, StellarNetwork::Testnet).unwrap();
        let encoded = envelope_base64(&envelope).unwrap();
        let decoded = TransactionEnvelope::from_xdr_base64(&encoded, Limits::none()).unwrap();
        assert_eq!(decoded, envelope);
    }

    #[test]
    fn claimable_balance_with_memo() {
        let mut req = request(account(5), Asset::Usdc, "25.50");
        req.use_claimable_balance = true;
        req.memo = Some(StellarMemo::Text("no trustline".to_owned()));
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();

        let OperationBody::CreateClaimableBalance(_) = &tx.operations[0].body else {
            panic!("expected CreateClaimableBalance operation");
        };
        let Memo::Text(text) = tx.memo else {
            panic!("expected text memo");
        };
        assert_eq!(text.as_slice(), b"no trustline");
    }

    // ΓöÇΓöÇ Path payment tests ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

    fn quote(destination_amount: i64) -> PathQuote {
        PathQuote {
            path: vec![PathAsset::Credit {
                code: "USDC".to_owned(),
                issuer: StellarNetwork::Testnet.usdc_issuer().to_owned(),
            }],
            destination_amount,
        }
    }

    #[test]
    fn strict_send_path_payment_builds_within_slippage() {
        // Expect 10 USDC; quote gives 10.05 USDC; 1% slippage allows >= 9.9.
        let tx = build_path_payment_strict_send(
            &signer().public_key(),
            1,
            &account(2),
            Asset::Xlm,
            Money::parse(Asset::Xlm, "5").unwrap(),
            Asset::Usdc,
            Money::parse(Asset::Usdc, "10").unwrap(),
            &quote(100_500_000),
            SlippageLimit { bps: 100 },
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let OperationBody::PathPaymentStrictSend(op) = &tx.operations[0].body else {
            panic!("expected PathPaymentStrictSend");
        };
        assert_eq!(op.send_amount, 50_000_000);
        assert_eq!(op.dest_min, 99_000_000);
        assert_eq!(op.path.len(), 1);
    }

    #[test]
    fn strict_send_path_payment_fails_on_slippage() {
        // Expect 10 USDC; quote gives only 9.5 USDC; 1% slippage allows >= 9.9.
        let refused = build_path_payment_strict_send(
            &signer().public_key(),
            1,
            &account(2),
            Asset::Xlm,
            Money::parse(Asset::Xlm, "5").unwrap(),
            Asset::Usdc,
            Money::parse(Asset::Usdc, "10").unwrap(),
            &quote(95_000_000),
            SlippageLimit { bps: 100 },
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(matches!(
            refused,
            Err(PaymentError::SlippageExceeded { .. })
        ));
    }

    #[test]
    fn strict_receive_path_payment_builds_within_slippage() {
        // Expect to spend 5 XLM; quote needs 5.02 XLM; 1% allows <= 5.05.
        let tx = build_path_payment_strict_receive(
            &signer().public_key(),
            1,
            &account(2),
            Asset::Xlm,
            Money::parse(Asset::Xlm, "5").unwrap(),
            Asset::Usdc,
            Money::parse(Asset::Usdc, "10").unwrap(),
            &quote(50_200_000),
            SlippageLimit { bps: 100 },
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();
        let OperationBody::PathPaymentStrictReceive(op) = &tx.operations[0].body else {
            panic!("expected PathPaymentStrictReceive");
        };
        assert_eq!(op.dest_amount, 100_000_000);
        assert_eq!(op.send_max, 50_500_000);
    }

    #[test]
    fn strict_receive_path_payment_fails_on_slippage() {
        // Expect to spend 5 XLM; quote needs 5.5 XLM; 1% allows <= 5.05.
        let refused = build_path_payment_strict_receive(
            &signer().public_key(),
            1,
            &account(2),
            Asset::Xlm,
            Money::parse(Asset::Xlm, "5").unwrap(),
            Asset::Usdc,
            Money::parse(Asset::Usdc, "10").unwrap(),
            &quote(55_000_000),
            SlippageLimit { bps: 100 },
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        );
        assert!(matches!(
            refused,
            Err(PaymentError::SlippageExceeded { .. })
        ));
    }

    #[test]
    fn direct_payment_still_works_when_flag_is_false() {
        let mut req = request(account(2), Asset::Xlm, "1");
        req.use_claimable_balance = false;
        let tx = build_payment(
            &signer().public_key(),
            1,
            &req,
            StellarNetwork::Testnet,
            1_800_000_000,
            BASE_FEE,
        )
        .unwrap();

        // Should be a normal Payment operation.
        let OperationBody::Payment(payment) = &tx.operations[0].body else {
            panic!("expected Payment operation, not CreateClaimableBalance");
        };
        assert_eq!(payment.amount, 10_000_000);
    }
}
