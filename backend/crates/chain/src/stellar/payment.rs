//! Building and signing Stellar payments.
//!
//! Transactions are built directly from the Stellar Development Foundation's
//! XDR definitions (`stellar-xdr`), so what EngiPay signs is exactly what the
//! network verifies.

use engipay_core::stellar::{StellarAddress, StellarAddressError, parse_address};
use engipay_core::{Asset, Chain, Money};
use stellar_xdr::{
    AccountId, AlphaNum4, AssetCode4, DecoratedSignature, Limits, Memo, MuxedAccount,
    MuxedAccountMed25519, Operation, OperationBody, PaymentOp, Preconditions, PublicKey,
    SequenceNumber, Signature, SignatureHint, TimeBounds, TimePoint, Transaction,
    TransactionEnvelope, TransactionExt, TransactionV1Envelope, Uint256, WriteXdr,
};
use zeroize::Zeroizing;

use super::network::StellarNetwork;

/// Base fee per operation, in stroops. 100 is the network minimum; Horizon's
/// fee stats should drive this once sends are under real load.
pub const BASE_FEE: u32 = 100;

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
}

/// What to pay, before it is turned into a transaction.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaymentRequest {
    pub destination: String,
    pub money: Money,
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

/// Builds an unsigned payment transaction.
///
/// `sequence` is the source account's *current* sequence number; the
/// transaction uses the next one. `valid_until` is a unix time after which the
/// network rejects it, so a transaction stuck in flight cannot land hours later.
pub fn build_payment(
    source: &[u8; 32],
    sequence: i64,
    request: &PaymentRequest,
    network: StellarNetwork,
    valid_until: u64,
) -> Result<Transaction, PaymentError> {
    let destination = muxed_account(&request.destination)?;
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

    let operation = Operation {
        source_account: None,
        body: OperationBody::Payment(PaymentOp {
            destination,
            asset,
            amount,
        }),
    };

    Ok(Transaction {
        source_account: MuxedAccount::Ed25519(Uint256(*source)),
        fee: BASE_FEE,
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

/// Signs a transaction for `network` and returns the envelope and its hash.
pub fn sign(
    transaction: Transaction,
    signer: &dyn StellarSigner,
    network: StellarNetwork,
) -> Result<(TransactionEnvelope, [u8; 32]), PaymentError> {
    let hash = transaction
        .hash(network.network_id())
        .map_err(|error| PaymentError::Encoding(error.to_string()))?;
    let public_key = signer.public_key();
    let hint = [
        public_key[28],
        public_key[29],
        public_key[30],
        public_key[31],
    ];
    let signature = DecoratedSignature {
        hint: SignatureHint(hint),
        signature: Signature(
            signer
                .sign(&hash)
                .to_vec()
                .try_into()
                .map_err(|_| PaymentError::Encoding("signature length".to_owned()))?,
        ),
    };
    let envelope = TransactionEnvelope::Tx(TransactionV1Envelope {
        tx: transaction,
        signatures: vec![signature]
            .try_into()
            .map_err(|_| PaymentError::Encoding("too many signatures".to_owned()))?,
    });
    Ok((envelope, hash))
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

    fn signer() -> LocalTestnetSigner {
        let secret = stellar_strkey::ed25519::PrivateKey([7; 32]);
        LocalTestnetSigner::from_secret(
            secret.as_unredacted().to_string().as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap()
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
        )
        .unwrap();
        let (envelope, _) = sign(tx, &signer, StellarNetwork::Testnet).unwrap();
        let encoded = envelope_base64(&envelope).unwrap();
        let decoded = TransactionEnvelope::from_xdr_base64(&encoded, Limits::none()).unwrap();
        assert_eq!(decoded, envelope);
    }
}
