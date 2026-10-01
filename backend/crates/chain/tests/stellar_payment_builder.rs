//! Dedicated integration and contract tests for Stellar payment transaction building.
//!
//! Verifies:
//! - Valid standard Ed25519 addresses (`G...`) build correctly.
//! - Valid Med25519 muxed addresses (`M...`) preserve their embedded ID.
//! - Invalid strkeys, wrong checksums, or malformed addresses return typed errors.
//! - Invalid or zero amounts return typed errors.
//! - Unsupported chain assets return typed errors.
//! - Resulting XDR parses cleanly with `stellar_xdr::ReadXdr` and roundtrips through base64.

use engipay_chain::stellar::network::StellarNetwork;
use engipay_chain::stellar::payment::{
    build_payment, envelope_base64, sign, LocalTestnetSigner, PaymentError, PaymentRequest,
    StellarSigner, BASE_FEE,
};
use engipay_core::stellar::StellarAddressError;
use engipay_core::{Asset, Money};
use stellar_xdr::{
    Limits, MuxedAccount, MuxedAccountMed25519, OperationBody, ReadXdr, SequenceNumber,
    TransactionEnvelope, Uint256, WriteXdr,
};

fn sample_signer() -> LocalTestnetSigner {
    let secret = stellar_strkey::ed25519::PrivateKey([42; 32]);
    LocalTestnetSigner::from_secret(
        secret.as_unredacted().to_string().as_str(),
        StellarNetwork::Testnet,
    )
    .expect("valid testnet signer")
}

fn sample_account(seed: u8) -> String {
    stellar_strkey::ed25519::PublicKey([seed; 32])
        .to_string()
        .as_str()
        .to_owned()
}

#[test]
fn test_build_payment_valid_g_address_native_xlm() {
    let signer = sample_signer();
    let dest = sample_account(101);
    let request = PaymentRequest {
        destination: dest.clone(),
        money: Money::parse(Asset::Xlm, "12.3456789").expect("valid money"),
    };

    let tx = build_payment(
        &signer.public_key(),
        1000,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    )
    .expect("build_payment should succeed for valid G... address");

    assert_eq!(tx.seq_num, SequenceNumber(1001));
    assert_eq!(tx.fee, BASE_FEE);
    assert_eq!(tx.operations.len(), 1);

    let OperationBody::Payment(payment) = &tx.operations[0].body else {
        panic!("operation body must be payment");
    };

    assert_eq!(payment.amount, 123_456_789);
    assert_eq!(payment.asset, stellar_xdr::Asset::Native);

    let MuxedAccount::Ed25519(dest_bytes) = &payment.destination else {
        panic!("expected Ed25519 standard destination");
    };
    let parsed_dest = stellar_strkey::ed25519::PublicKey::from_string(&dest).unwrap();
    assert_eq!(dest_bytes.0, parsed_dest.0);
}

#[test]
fn test_build_payment_valid_g_address_usdc() {
    let signer = sample_signer();
    let dest = sample_account(102);
    let request = PaymentRequest {
        destination: dest,
        money: Money::parse(Asset::Usdc, "50.0000000").expect("valid money"),
    };

    let tx = build_payment(
        &signer.public_key(),
        500,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    )
    .expect("build_payment should succeed for USDC");

    let OperationBody::Payment(payment) = &tx.operations[0].body else {
        panic!("operation body must be payment");
    };

    assert_eq!(payment.amount, 500_000_000);
    assert!(matches!(
        payment.asset,
        stellar_xdr::Asset::CreditAlphanum4(_)
    ));
}

#[test]
fn test_build_payment_muxed_m_address_preserves_id() {
    let signer = sample_signer();
    let base_account = sample_account(77);
    let muxed_id: u64 = 987654321;
    let muxed_addr = engipay_core::stellar::muxed_deposit_address(&base_account, muxed_id)
        .expect("valid muxed address");

    assert!(muxed_addr.starts_with('M'));

    let request = PaymentRequest {
        destination: muxed_addr,
        money: Money::parse(Asset::Xlm, "5.0").expect("valid money"),
    };

    let tx = build_payment(
        &signer.public_key(),
        200,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    )
    .expect("build_payment should succeed for muxed destination");

    let OperationBody::Payment(payment) = &tx.operations[0].body else {
        panic!("operation body must be payment");
    };

    assert_eq!(
        payment.destination,
        MuxedAccount::MuxedEd25519(MuxedAccountMed25519 {
            id: muxed_id,
            ed25519: Uint256([77; 32]),
        })
    );
}

#[test]
fn test_build_payment_invalid_strkey_characters_returns_typed_error() {
    let signer = sample_signer();
    let invalid_chars = [
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1", // '1' is not base32
        "GIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",  // 'I' is not base32
        "GLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL",  // 'L' is not base32
        "not_an_address_at_all",
        "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", // EVM address
    ];

    for bad in invalid_chars {
        let request = PaymentRequest {
            destination: bad.to_owned(),
            money: Money::parse(Asset::Xlm, "1.0").unwrap(),
        };
        let res = build_payment(
            &signer.public_key(),
            1,
            &request,
            StellarNetwork::Testnet,
            1_800_000_000,
        );
        match res {
            Err(PaymentError::Destination(StellarAddressError::Invalid)) => {}
            other => panic!("expected PaymentError::Destination(Invalid) for {bad}, got {other:?}"),
        }
    }
}

#[test]
fn test_build_payment_malformed_muxed_strkey_returns_typed_error() {
    let signer = sample_signer();
    // M address with corrupted checksum or invalid payload length
    let bad_m_address = "MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPQAAAAAAAAAAE234";

    let request = PaymentRequest {
        destination: bad_m_address.to_owned(),
        money: Money::parse(Asset::Xlm, "1.0").unwrap(),
    };
    let res = build_payment(
        &signer.public_key(),
        1,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    );
    assert!(
        matches!(
            res,
            Err(PaymentError::Destination(StellarAddressError::Invalid))
        ),
        "corrupted M... address must return typed error"
    );
}

#[test]
fn test_build_payment_unsupported_asset_returns_typed_error() {
    let signer = sample_signer();
    let dest = sample_account(1);
    let request = PaymentRequest {
        destination: dest,
        money: Money::parse(Asset::Btc, "0.5").unwrap(),
    };
    let res = build_payment(
        &signer.public_key(),
        1,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    );
    assert!(
        matches!(res, Err(PaymentError::UnsupportedAsset(Asset::Btc))),
        "BTC on Stellar must be rejected with UnsupportedAsset"
    );
}

#[test]
fn test_build_payment_zero_amount_returns_typed_error() {
    let signer = sample_signer();
    let dest = sample_account(1);
    let request = PaymentRequest {
        destination: dest,
        money: Money::parse(Asset::Xlm, "0").unwrap(),
    };
    let res = build_payment(
        &signer.public_key(),
        1,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    );
    assert!(
        matches!(res, Err(PaymentError::Amount(_))),
        "zero amount must return PaymentError::Amount"
    );
}

#[test]
fn test_built_xdr_parses_cleanly_with_stellar_xdr() {
    let signer = sample_signer();
    let base_dest = sample_account(88);
    let muxed_id: u64 = 4242;
    let muxed_dest = engipay_core::stellar::muxed_deposit_address(&base_dest, muxed_id).unwrap();

    let request = PaymentRequest {
        destination: muxed_dest,
        money: Money::parse(Asset::Xlm, "2.75").unwrap(),
    };

    let tx = build_payment(
        &signer.public_key(),
        10,
        &request,
        StellarNetwork::Testnet,
        1_800_000_000,
    )
    .expect("build_payment should succeed");

    let (envelope, hash) = sign(tx, &signer, StellarNetwork::Testnet).expect("sign should succeed");

    // 1. Encode envelope to Base64 XDR string
    let xdr_base64 = envelope_base64(&envelope).expect("base64 encoding must succeed");
    assert!(!xdr_base64.is_empty());

    // 2. Parse cleanly from Base64 XDR using stellar_xdr::ReadXdr
    let decoded_envelope = TransactionEnvelope::from_xdr_base64(&xdr_base64, Limits::none())
        .expect("TransactionEnvelope must parse cleanly from base64 XDR");

    assert_eq!(decoded_envelope, envelope);

    // 3. Roundtrip binary XDR encoding and decoding
    let raw_bytes = envelope
        .to_xdr(Limits::none())
        .expect("binary XDR encoding");
    let from_bytes = TransactionEnvelope::from_xdr(&raw_bytes, Limits::none())
        .expect("TransactionEnvelope must parse cleanly from raw bytes");

    assert_eq!(from_bytes, envelope);

    // 4. Verify transaction hash consistency
    let TransactionEnvelope::Tx(v1) = &decoded_envelope else {
        panic!("expected V1 envelope");
    };
    let computed_hash = v1.tx.hash(StellarNetwork::Testnet.network_id()).unwrap();
    assert_eq!(computed_hash, hash);
}
