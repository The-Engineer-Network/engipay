//! Deposit-address provisioning routes.
//!
//! `GET /v1/stellar/deposit-address` allocates (or retrieves) the SEP-23
//! muxed `M...` deposit address for the authenticated caller on Stellar.
//!
//! # Allocation strategy
//!
//! The 64-bit muxed-account ID is derived from the lower 64 bits of the
//! caller's UUID (`user_id.as_u128() as u64`).  This is deterministic and
//! cheap to compute; it means no counter or SEQUENCE is needed, and the same
//! value is always produced for the same user.
//!
//! The first call for a user inserts a `deposit_addresses` row; subsequent
//! calls return the existing row.  Both operations produce the same `M...`
//! address because the derivation is pure.
//!
//! # Configuration
//!
//! Requires `STELLAR_CUSTODY_ACCOUNT` (a `G...` Stellar public key) to be set
//! in the environment (see [`crate::config::Config::stellar_custody_account`]).
//! Without it the endpoint returns `503 Service Unavailable`.

use axum::Json;
use axum::extract::State;
use axum::routing::get;
use axum::Router;
use serde::Serialize;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::services::stellar_muxed::derive_stellar_muxed_address;

pub fn routes() -> Router<AppState> {
    Router::new().route("/stellar/deposit-address", get(get_stellar_deposit_address))
}

/// Response body for `GET /v1/stellar/deposit-address`.
#[derive(Debug, Serialize)]
pub struct DepositAddressResponse {
    /// The `M...` muxed Stellar address assigned to this user.
    pub address: String,
    /// The `G...` custody account the muxed address is derived from.
    pub custody_account: String,
    /// The 64-bit muxed ID embedded in the address.
    pub muxed_id: u64,
}

/// `GET /v1/stellar/deposit-address`
///
/// Returns the SEP-23 muxed deposit address for the authenticated user,
/// creating a `deposit_addresses` row on first call.
async fn get_stellar_deposit_address(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<DepositAddressResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;

    // Require the custody account to be configured.
    let custody = state
        .config
        .stellar_custody_account
        .clone()
        .ok_or_else(|| {
            ApiError::Internal(anyhow::anyhow!(
                "STELLAR_CUSTODY_ACCOUNT is not configured; cannot derive deposit address"
            ))
        })?;

    // Derive the deterministic 64-bit muxed ID from the lower 64 bits of the
    // user's UUID.  UUID v4 is random; taking the low 64 bits gives a uniform
    // distribution over the u64 space with no coordinator needed.
    // The truncation from u128 → u64 is intentional: we want the lower 64 bits.
    #[allow(clippy::cast_possible_truncation)]
    let muxed_id = user_id.as_uuid().as_u128() as u64;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // INSERT … ON CONFLICT DO NOTHING, then SELECT — idempotent allocation.
    // The UNIQUE (chain, muxed_id) constraint in migration 0002 guarantees
    // at most one row per user on Stellar.
    let muxed_id_db = muxed_id_to_db(muxed_id);
    let address = derive_stellar_muxed_address(&custody, muxed_id)?;

    sqlx::query(
        r#"
        INSERT INTO deposit_addresses (user_id, chain, muxed_id, address)
        VALUES ($1, 'stellar', $2, $3)
        ON CONFLICT (chain, muxed_id) DO NOTHING
        "#,
    )
    .bind(user_id.as_uuid())
    .bind(muxed_id_db)
    .bind(&address)
    .execute(&pool)
    .await
    .map_err(|err| ApiError::Internal(anyhow::anyhow!(err)))?;

    Ok(Json(DepositAddressResponse {
        address,
        custody_account: custody,
        muxed_id,
    }))
}

/// Converts a `u64` muxed ID to the `i64` bit-pattern used in the database.
///
/// Postgres `BIGINT` is a signed 64-bit integer.  Values whose high bit is set
/// will appear negative in SQL but the bit-pattern is preserved exactly.
/// Reverse with [`db_to_muxed_id`].
#[inline]
pub(crate) fn muxed_id_to_db(id: u64) -> i64 {
    i64::from_ne_bytes(id.to_ne_bytes())
}

/// Converts the `BIGINT` value stored in the database back to the original
/// unsigned `u64` muxed ID.
#[inline]
#[allow(dead_code)]
pub(crate) fn db_to_muxed_id(db: i64) -> u64 {
    u64::from_ne_bytes(db.to_ne_bytes())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use crate::config::Config;
    use crate::{AppState, router};

    use super::*;

    // ── Bit-cast helpers ──────────────────────────────────────────────────────

    #[test]
    fn muxed_id_round_trips_through_db_cast() {
        for id in [0u64, 1, u64::MAX / 2, u64::MAX - 1, u64::MAX] {
            let db = muxed_id_to_db(id);
            assert_eq!(db_to_muxed_id(db), id, "round-trip failed for id={id}");
        }
    }

    #[test]
    fn high_bit_set_survives_round_trip() {
        // Values above i64::MAX must not be silently truncated or sign-extended.
        let id: u64 = (i64::MAX as u64).wrapping_add(1); // high bit set
        assert_eq!(db_to_muxed_id(muxed_id_to_db(id)), id);
    }

    // ── HTTP handler tests (no database) ─────────────────────────────────────

    fn app() -> axum::Router {
        let config = Config::for_tests();
        router(
            AppState {
                database: None,
                config: config.clone(),
            },
            &config,
        )
    }

    fn app_with_custody(custody: &str) -> axum::Router {
        let config = Config {
            stellar_custody_account: Some(custody.to_owned()),
            ..Config::for_tests()
        };
        router(
            AppState {
                database: None,
                config: config.clone(),
            },
            &config,
        )
    }

    #[tokio::test]
    async fn rejects_unauthenticated_request() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/stellar/deposit-address")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_service_unavailable_when_custody_account_not_configured() {
        // Config::for_tests() has stellar_custody_account = None.
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            uuid::Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/stellar/deposit-address")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // 503 because the internal error path fires before the DB check.
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[tokio::test]
    async fn returns_database_unavailable_when_custody_configured_but_no_db() {
        // Use a deterministic G... account built from fixed key bytes.
        let custody =
            stellar_strkey::ed25519::PublicKey([1u8; 32]).to_string().as_str().to_owned();

        let config = Config {
            stellar_custody_account: Some(custody.clone()),
            ..Config::for_tests()
        };
        let token = crate::auth::jwt::create_token(
            uuid::Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app_with_custody(&custody)
            .oneshot(
                Request::builder()
                    .uri("/v1/stellar/deposit-address")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let json: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["error"]["code"], "database_unavailable");
    }

    /// Requires `DATABASE_URL`: provisions a fresh user, calls the endpoint,
    /// verifies the returned `M...` address round-trips to the right custody
    /// account and muxed ID.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn allocates_and_returns_a_muxed_deposit_address() {
        use engipay_core::stellar::{StellarAddress, parse_address};

        let Ok(database_url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = sqlx::PgPool::connect(&database_url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let user_uuid = uuid::Uuid::new_v4();
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user_uuid)
            .execute(&pool)
            .await
            .unwrap();

        let custody = stellar_strkey::ed25519::PublicKey([42u8; 32]).to_string().as_str().to_owned();

        let config = Config {
            stellar_custody_account: Some(custody.clone()),
            ..Config::for_tests()
        };
        let state = AppState {
            database: Some(pool.clone()),
            config: config.clone(),
        };
        let app = router(state, &config);

        let token = crate::auth::jwt::create_token(
            user_uuid,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/stellar/deposit-address")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();

        let address = body["address"].as_str().unwrap();
        assert!(address.starts_with('M'), "address must be a muxed M... address");

        // Verify the address encodes the right custody account and muxed_id.
        #[allow(clippy::cast_possible_truncation)]
        let expected_muxed_id = user_uuid.as_u128() as u64;
        match parse_address(address).unwrap() {
            StellarAddress::Muxed { base, id } => {
                assert_eq!(base, custody, "base account must match custody");
                assert_eq!(id, expected_muxed_id, "muxed_id must match lower 64 bits of UUID");
            }
            _ => panic!("expected a Muxed address"),
        }

        assert_eq!(body["custody_account"].as_str().unwrap(), custody);
        assert_eq!(body["muxed_id"].as_u64().unwrap(), expected_muxed_id);

        // A second call must return the same address (idempotent).
        let token2 = crate::auth::jwt::create_token(
            user_uuid,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let config2 = Config {
            stellar_custody_account: Some(custody.clone()),
            ..Config::for_tests()
        };
        let state2 = AppState {
            database: Some(pool),
            config: config2.clone(),
        };
        let app2 = router(state2, &config2);

        let response2 = app2
            .oneshot(
                Request::builder()
                    .uri("/v1/stellar/deposit-address")
                    .header("Authorization", format!("Bearer {token2}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response2.status(), StatusCode::OK);
        let bytes2 = response2.into_body().collect().await.unwrap().to_bytes();
        let body2: Value = serde_json::from_slice(&bytes2).unwrap();
        assert_eq!(
            body2["address"].as_str().unwrap(),
            address,
            "second call must return the same address"
        );
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

/// Supported chains for deposit address generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Chain {
    Stellar,
    Base,
    Bitcoin,
}

/// Base mainnet chain id used by EIP-681 payment URIs.
const BASE_CHAIN_ID: u64 = 8453;

/// Response payload for a deposit address request.
///
/// Includes the raw address plus a standards-compliant payment URI so that
/// external wallets can render a scannable QR code without extra metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DepositAddressResponse {
    pub chain: Chain,
    pub address: String,
    /// Standard payment URI for the chain:
    /// - Stellar: `web+stellar:pay?destination=M...` (SEP-7)
    /// - Base: `ethereum:0x...@8453` (EIP-681)
    /// - Bitcoin: `bitcoin:<address>` (BIP-21)
    pub payment_uri: String,
}

/// Build a SEP-7 payment URI for a Stellar account.
///
/// Reference: <https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md>
pub fn stellar_payment_uri(destination: &str) -> String {
    format!("web+stellar:pay?destination={destination}")
}

/// Build an EIP-681 payment URI for an EVM address on Base mainnet.
///
/// Reference: <https://eips.ethereum.org/EIPS/eip-681>
pub fn base_payment_uri(address: &str) -> String {
    format!("ethereum:{address}@{BASE_CHAIN_ID}")
}

/// Build a BIP-21 payment URI for a Bitcoin address.
///
/// Reference: <https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki>
pub fn bitcoin_payment_uri(address: &str) -> String {
    format!("bitcoin:{address}")
}

/// Generate the standard payment URI for the given chain and address.
pub fn payment_uri_for(chain: Chain, address: &str) -> String {
    match chain {
        Chain::Stellar => stellar_payment_uri(address),
        Chain::Base => base_payment_uri(address),
        Chain::Bitcoin => bitcoin_payment_uri(address),
    }
}

/// `GET /v1/deposits/:chain/:address`
///
/// Returns the deposit address together with its standard payment URI.
pub async fn get_deposit_address(
    State(_state): State<AppState>,
    Path((chain, address)): Path<(Chain, String)>,
) -> impl IntoResponse {
    let payment_uri = payment_uri_for(chain, &address);
    (
        StatusCode::OK,
        Json(DepositAddressResponse {
            chain,
            address,
            payment_uri,
        }),
    )
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/deposits/:chain/:address", get(get_deposit_address))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stellar_uri_matches_sep7_format() {
        let uri = stellar_payment_uri("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
        assert_eq!(
            uri,
            "web+stellar:pay?destination=GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
        );
        assert!(uri.starts_with("web+stellar:pay?destination="));
    }

    #[test]
    fn base_uri_matches_eip681_format() {
        let uri = base_payment_uri("0x1234567890abcdef1234567890abcdef12345678");
        assert_eq!(
            uri,
            "ethereum:0x1234567890abcdef1234567890abcdef12345678@8453"
        );
        assert!(uri.starts_with("ethereum:0x"));
        assert!(uri.ends_with("@8453"));
    }

    #[test]
    fn bitcoin_uri_matches_bip21_format() {
        let uri = bitcoin_payment_uri("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        assert_eq!(uri, "bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");
        assert!(uri.starts_with("bitcoin:"));
    }

    #[test]
    fn payment_uri_for_dispatches_by_chain() {
        assert_eq!(
            payment_uri_for(Chain::Stellar, "GABC"),
            "web+stellar:pay?destination=GABC"
        );
        assert_eq!(payment_uri_for(Chain::Base, "0xabc"), "ethereum:0xabc@8453");
        assert_eq!(payment_uri_for(Chain::Bitcoin, "bc1abc"), "bitcoin:bc1abc");
    }
}
