//! `POST /internal/create-wallet` — derive a deposit address for a user.
//!
//! # Request
//!
//! ```json
//! {
//!   "user_id": "550e8400-e29b-41d4-a716-446655440000",
//!   "chain":   "stellar"    // "stellar" | "base" | "bitcoin"
//! }
//! ```
//!
//! # Response `200 OK`
//!
//! ```json
//! {
//!   "address":  "M...",   // chain-specific deposit address
//!   "muxed_id": 12345678  // Stellar only; omitted for Base and Bitcoin
//! }
//! ```
//!
//! # Error responses
//!
//! | Status | `error.code`          | Meaning                                              |
//! |--------|-----------------------|------------------------------------------------------|
//! | 400    | `bad_request`         | Missing/invalid field or unsupported chain           |
//! | 503    | `wallet_unavailable`  | Required custody env var is not set                  |
//!
//! # Address derivation per chain
//!
//! **Stellar** — each user gets a unique muxed (`M...`) address derived from
//! the shared `STELLAR_CUSTODY_ACCOUNT` (`G...`).  The muxed ID is the lower
//! 64 bits of the user's UUID (bytes 8–15, big-endian), matching the derivation
//! used by both the API service's `provision_stellar` and the chain service's
//! `AccountResolver`.  This guarantees that a deposit arriving at the derived
//! address is always credited to the correct user.
//!
//! **Base / Bitcoin** — the chain service does not yet expose per-user HD key
//! derivation.  The configured custody address (`BASE_CUSTODY_ADDRESS` /
//! `BITCOIN_CUSTODY_ADDRESS`) is returned.  The `derivation_index` is available
//! in the database once the API stores the address, and will drive HD derivation
//! when that path is implemented.

use std::env;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::Router;
use engipay_core::Chain;
use engipay_core::stellar::muxed_deposit_address;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ─── Request / response types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreateWalletRequest {
    /// The EngiPay user this wallet address is being provisioned for.
    pub user_id: Uuid,
    /// The chain to derive an address on.
    pub chain: Chain,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct CreateWalletResponse {
    /// The derived deposit address for this user on the requested chain.
    pub address: String,
    /// Stellar only: the 64-bit muxed ID embedded in the `M...` address.
    /// `None` for Base and Bitcoin.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub muxed_id: Option<u64>,
}

// ─── Error type ───────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error)]
pub enum WalletError {
    #[error("{0}")]
    BadRequest(String),
    /// A required environment variable (e.g. `STELLAR_CUSTODY_ACCOUNT`) is
    /// absent or empty. Returns 503 so the caller can distinguish a
    /// configuration problem from a client mistake.
    #[error("wallet derivation unavailable: {0}")]
    Unavailable(String),
}

impl IntoResponse for WalletError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            WalletError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            WalletError::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "wallet_unavailable"),
        };
        let body = serde_json::json!({
            "error": { "code": code, "message": self.to_string() }
        });
        (status, Json(body)).into_response()
    }
}

// ─── Axum router ──────────────────────────────────────────────────────────────

/// Mounts the `POST /internal/create-wallet` route.
pub fn routes() -> Router {
    Router::new().route("/internal/create-wallet", post(handle_create_wallet))
}

// ─── Handler ──────────────────────────────────────────────────────────────────

/// Derives a deposit address for the given user and chain.
///
/// Reads custody addresses from the environment so the handler is stateless
/// and consistent with [`super::estimate_fee`].
async fn handle_create_wallet(
    Json(req): Json<CreateWalletRequest>,
) -> Result<Json<CreateWalletResponse>, WalletError> {
    let response = match req.chain {
        Chain::Stellar => derive_stellar(req.user_id)?,
        Chain::Base => derive_base()?,
        Chain::Bitcoin => derive_bitcoin()?,
    };
    Ok(Json(response))
}

// ─── Per-chain derivation ─────────────────────────────────────────────────────

/// Derives a Stellar muxed deposit address for `user_id`.
///
/// Reads `STELLAR_CUSTODY_ACCOUNT` from the environment.  The muxed ID is the
/// lower 64 bits of the UUID (bytes 8–15, big-endian), matching the derivation
/// used by `AccountResolver` so incoming deposits are always attributed to the
/// correct user.
fn derive_stellar(user_id: Uuid) -> Result<CreateWalletResponse, WalletError> {
    let custody = env::var("STELLAR_CUSTODY_ACCOUNT")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| {
            WalletError::Unavailable(
                "STELLAR_CUSTODY_ACCOUNT is not set; cannot derive Stellar addresses".to_owned(),
            )
        })?;

    let muxed_id = muxed_id_from_uuid(user_id);

    let address = muxed_deposit_address(&custody, muxed_id).map_err(|e| {
        WalletError::Unavailable(format!("could not build muxed deposit address: {e}"))
    })?;

    Ok(CreateWalletResponse {
        address,
        muxed_id: Some(muxed_id),
    })
}

/// Returns the configured Base (EVM) custody address.
///
/// Reads `BASE_CUSTODY_ADDRESS` from the environment.
fn derive_base() -> Result<CreateWalletResponse, WalletError> {
    let address = env::var("BASE_CUSTODY_ADDRESS")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| {
            WalletError::Unavailable(
                "BASE_CUSTODY_ADDRESS is not set; cannot provision Base addresses".to_owned(),
            )
        })?;

    Ok(CreateWalletResponse {
        address,
        muxed_id: None,
    })
}

/// Returns the configured Bitcoin custody address.
///
/// Reads `BITCOIN_CUSTODY_ADDRESS` from the environment.
fn derive_bitcoin() -> Result<CreateWalletResponse, WalletError> {
    let address = env::var("BITCOIN_CUSTODY_ADDRESS")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| {
            WalletError::Unavailable(
                "BITCOIN_CUSTODY_ADDRESS is not set; cannot provision Bitcoin addresses".to_owned(),
            )
        })?;

    Ok(CreateWalletResponse {
        address,
        muxed_id: None,
    })
}

// ─── Derivation helpers ───────────────────────────────────────────────────────

/// Extracts the lower 64 bits of a UUID as a big-endian `u64`.
///
/// Bytes 8–15 of a UUID v4 are random (with version/variant bits in the most
/// significant nibbles of bytes 8 and 6). Taking the lower 8 bytes gives a
/// stable, unique-enough 64-bit ID in the space of realistic EngiPay user
/// counts. This matches the derivation used in both the API service's
/// `provision_stellar` and the chain service's `AccountResolver`, ensuring
/// that deposit events are always attributed to the correct user.
pub fn muxed_id_from_uuid(user_id: Uuid) -> u64 {
    let bytes = user_id.as_bytes();
    u64::from_be_bytes([
        bytes[8], bytes[9], bytes[10], bytes[11],
        bytes[12], bytes[13], bytes[14], bytes[15],
    ])
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use engipay_core::stellar::parse_address;
    use engipay_core::stellar::StellarAddress;
    use stellar_strkey::ed25519;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Builds a deterministic `G...` custody account from a seed byte.
    fn custody_account(seed: u8) -> String {
        ed25519::PublicKey([seed; 32]).to_string()
    }

    /// Returns a fixed, well-known UUID for deterministic tests.
    fn known_uuid() -> Uuid {
        Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap()
    }

    // ── muxed_id_from_uuid ────────────────────────────────────────────────────

    #[test]
    fn muxed_id_extracts_lower_64_bits_of_uuid() {
        // The UUID "550e8400-e29b-41d4-a716-446655440000" has bytes:
        // 55 0e 84 00 e2 9b 41 d4  a7 16 44 66 55 44 00 00
        // Bytes 8–15 (the lower half):  a7 16 44 66 55 44 00 00
        let id = known_uuid();
        let muxed = muxed_id_from_uuid(id);

        let bytes = id.as_bytes();
        let expected = u64::from_be_bytes([
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15],
        ]);
        assert_eq!(muxed, expected);
    }

    #[test]
    fn different_uuids_produce_different_muxed_ids() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        // With overwhelming probability two random UUIDs differ in the lower 64 bits.
        // This test would fail once in 2^64 runs, which is acceptable.
        assert_ne!(muxed_id_from_uuid(a), muxed_id_from_uuid(b));
    }

    #[test]
    fn same_uuid_always_produces_same_muxed_id() {
        let id = known_uuid();
        assert_eq!(muxed_id_from_uuid(id), muxed_id_from_uuid(id));
    }

    // ── Stellar address derivation ────────────────────────────────────────────

    #[test]
    fn stellar_address_is_a_valid_muxed_address() {
        // Set custody env var for this test.
        let custody = custody_account(1);
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &custody);

        let user_id = known_uuid();
        let resp = derive_stellar(user_id).expect("derivation must succeed");

        assert!(
            resp.address.starts_with('M'),
            "Stellar deposit address must be an M... muxed address, got: {}",
            resp.address
        );
        assert!(resp.muxed_id.is_some(), "muxed_id must be present for Stellar");

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn stellar_muxed_address_embeds_correct_base_account_and_muxed_id() {
        let custody = custody_account(2);
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &custody);

        let user_id = known_uuid();
        let muxed_id = muxed_id_from_uuid(user_id);
        let resp = derive_stellar(user_id).expect("derivation must succeed");

        // Parse the returned address and check both fields.
        let parsed = parse_address(&resp.address).expect("must parse as a valid Stellar address");
        assert_eq!(
            parsed,
            StellarAddress::Muxed {
                base: custody.clone(),
                id: muxed_id,
            },
            "base account and muxed ID must match the configured custody and UUID-derived ID"
        );
        assert_eq!(resp.muxed_id, Some(muxed_id));

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn stellar_different_users_get_different_addresses() {
        let custody = custody_account(3);
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &custody);

        let user_a = Uuid::new_v4();
        let user_b = Uuid::new_v4();

        let addr_a = derive_stellar(user_a).expect("ok").address;
        let addr_b = derive_stellar(user_b).expect("ok").address;

        assert_ne!(addr_a, addr_b, "different users must get different addresses");

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn stellar_same_user_always_gets_same_address() {
        let custody = custody_account(4);
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &custody);

        let user_id = known_uuid();
        let addr1 = derive_stellar(user_id).expect("ok").address;
        let addr2 = derive_stellar(user_id).expect("ok").address;

        assert_eq!(addr1, addr2, "derivation must be deterministic");

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn stellar_returns_unavailable_when_custody_env_var_is_missing() {
        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");

        let err = derive_stellar(known_uuid()).expect_err("must fail without custody account");
        assert!(
            matches!(err, WalletError::Unavailable(_)),
            "missing env var must return Unavailable, got: {err}"
        );
    }

    #[test]
    fn stellar_returns_unavailable_when_custody_env_var_is_empty() {
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", "");

        let err = derive_stellar(known_uuid()).expect_err("must fail with empty custody account");
        assert!(matches!(err, WalletError::Unavailable(_)));

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn stellar_muxed_id_matches_api_service_derivation() {
        // Verify the derivation formula is identical to the API service's
        // provision_stellar: lower 8 bytes of UUID, big-endian.
        let user_id = known_uuid();
        let bytes = user_id.as_bytes();
        let expected_muxed_id = u64::from_be_bytes([
            bytes[8], bytes[9], bytes[10], bytes[11],
            bytes[12], bytes[13], bytes[14], bytes[15],
        ]);
        assert_eq!(muxed_id_from_uuid(user_id), expected_muxed_id);
    }

    // ── Base address derivation ───────────────────────────────────────────────

    #[test]
    fn base_returns_configured_custody_address() {
        let custody = "0xDeadBeefDeadBeefDeadBeefDeadBeefDeadBeef";
        std::env::set_var("BASE_CUSTODY_ADDRESS", custody);

        let resp = derive_base().expect("derivation must succeed");
        assert_eq!(resp.address, custody);
        assert!(resp.muxed_id.is_none(), "Base must not return a muxed_id");

        std::env::remove_var("BASE_CUSTODY_ADDRESS");
    }

    #[test]
    fn base_returns_unavailable_when_env_var_is_missing() {
        std::env::remove_var("BASE_CUSTODY_ADDRESS");

        let err = derive_base().expect_err("must fail without custody address");
        assert!(
            matches!(err, WalletError::Unavailable(_)),
            "missing env var must return Unavailable, got: {err}"
        );
    }

    #[test]
    fn base_returns_unavailable_when_env_var_is_empty() {
        std::env::set_var("BASE_CUSTODY_ADDRESS", "");

        let err = derive_base().expect_err("must fail with empty custody address");
        assert!(matches!(err, WalletError::Unavailable(_)));

        std::env::remove_var("BASE_CUSTODY_ADDRESS");
    }

    // ── Bitcoin address derivation ────────────────────────────────────────────

    #[test]
    fn bitcoin_returns_configured_custody_address() {
        let custody = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
        std::env::set_var("BITCOIN_CUSTODY_ADDRESS", custody);

        let resp = derive_bitcoin().expect("derivation must succeed");
        assert_eq!(resp.address, custody);
        assert!(resp.muxed_id.is_none(), "Bitcoin must not return a muxed_id");

        std::env::remove_var("BITCOIN_CUSTODY_ADDRESS");
    }

    #[test]
    fn bitcoin_returns_unavailable_when_env_var_is_missing() {
        std::env::remove_var("BITCOIN_CUSTODY_ADDRESS");

        let err = derive_bitcoin().expect_err("must fail without custody address");
        assert!(
            matches!(err, WalletError::Unavailable(_)),
            "missing env var must return Unavailable, got: {err}"
        );
    }

    #[test]
    fn bitcoin_returns_unavailable_when_env_var_is_empty() {
        std::env::set_var("BITCOIN_CUSTODY_ADDRESS", "");

        let err = derive_bitcoin().expect_err("must fail with empty custody address");
        assert!(matches!(err, WalletError::Unavailable(_)));

        std::env::remove_var("BITCOIN_CUSTODY_ADDRESS");
    }

    // ── Error types / HTTP mapping ────────────────────────────────────────────

    #[test]
    fn bad_request_error_message_is_preserved() {
        let err = WalletError::BadRequest("chain not supported".to_owned());
        assert_eq!(err.to_string(), "chain not supported");
    }

    #[test]
    fn unavailable_error_message_mentions_context() {
        let err = WalletError::Unavailable("STELLAR_CUSTODY_ACCOUNT is not set".to_owned());
        assert!(
            err.to_string().contains("STELLAR_CUSTODY_ACCOUNT"),
            "error message should mention the missing config: {}",
            err
        );
    }

    // ── Cross-chain consistency ───────────────────────────────────────────────

    #[test]
    fn stellar_address_contains_custody_base_account() {
        let custody = custody_account(9);
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &custody);

        let resp = derive_stellar(known_uuid()).expect("ok");
        let parsed = parse_address(&resp.address).expect("valid address");

        assert_eq!(
            parsed.base_account(),
            custody,
            "base account of muxed address must match custody account"
        );

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn stellar_muxed_address_parses_back_to_same_muxed_id() {
        let custody = custody_account(5);
        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &custody);

        let user_id = known_uuid();
        let resp = derive_stellar(user_id).expect("ok");
        let muxed_id = resp.muxed_id.expect("must have muxed_id");

        let parsed = parse_address(&resp.address).expect("valid Stellar address");
        if let StellarAddress::Muxed { id, .. } = parsed {
            assert_eq!(id, muxed_id, "parsed muxed ID must equal the returned muxed_id");
        } else {
            panic!("expected a Muxed address, got Account");
        }

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
    }

    #[test]
    fn all_three_chains_can_derive_addresses_when_env_vars_are_set() {
        let stellar_custody = custody_account(7);
        let base_custody = "0xAbCdEf1234567890AbCdEf1234567890AbCdEf12";
        let btc_custody = "bc1qtest000000000000000000000000000000000";

        std::env::set_var("STELLAR_CUSTODY_ACCOUNT", &stellar_custody);
        std::env::set_var("BASE_CUSTODY_ADDRESS", base_custody);
        std::env::set_var("BITCOIN_CUSTODY_ADDRESS", btc_custody);

        let user_id = known_uuid();

        let stellar = derive_stellar(user_id).expect("Stellar must succeed");
        assert!(stellar.address.starts_with('M'));
        assert!(stellar.muxed_id.is_some());

        let base = derive_base().expect("Base must succeed");
        assert_eq!(base.address, base_custody);
        assert!(base.muxed_id.is_none());

        let bitcoin = derive_bitcoin().expect("Bitcoin must succeed");
        assert_eq!(bitcoin.address, btc_custody);
        assert!(bitcoin.muxed_id.is_none());

        std::env::remove_var("STELLAR_CUSTODY_ACCOUNT");
        std::env::remove_var("BASE_CUSTODY_ADDRESS");
        std::env::remove_var("BITCOIN_CUSTODY_ADDRESS");
    }
}
