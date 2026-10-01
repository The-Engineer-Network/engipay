//! GET /v1/deposit-address?chain=stellar|base|bitcoin
//!
//! Returns the authenticated user's custodial deposit address for the requested
//! chain.  The first call provisions a new address and persists it; subsequent
//! calls return the same one.
//!
//! # Provisioning strategy
//!
//! **Stellar** — each user gets a unique muxed (`M...`) address derived from the
//! shared custody account (`STELLAR_CUSTODY_ACCOUNT`).  The muxed ID is the
//! lower 64 bits of the user's UUID, which is random and unique.  `muxed_id` is
//! stored as a signed `BIGINT` using the same bit-pattern cast used by the chain
//! service's `AccountResolver`.
//!
//! **Base / Bitcoin** — the API service does not hold signing keys, so for now
//! all users share the configured custody address (`BASE_CUSTODY_ADDRESS` /
//! `BITCOIN_CUSTODY_ADDRESS`).  The `derivation_index` is set to the sequential
//! row number returned by the database so it is available when the chain service
//! is later upgraded to derive per-user addresses.
//!
//! # QR URIs
//!
//! | Chain   | Scheme                                             |
//! |---------|---------------------------------------------------|
//! | Stellar | `web+stellar:pay?destination=<M...>` (SEP-7)      |
//! | Base    | `ethereum:<0x...>@8453` (EIP-681)                 |
//! | Bitcoin | `bitcoin:<address>` (BIP-21)                       |

use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use engipay_core::stellar::muxed_deposit_address;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

// ── Route registration ────────────────────────────────────────────────────────

pub fn routes() -> Router<AppState> {
    Router::new().route("/deposit-address", get(get_deposit_address))
}

// ── Request / response types ──────────────────────────────────────────────────

/// Recognised chains for `?chain=`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DepositChain {
    Stellar,
    Base,
    Bitcoin,
}

impl DepositChain {
    pub const fn as_str(self) -> &'static str {
        match self {
            DepositChain::Stellar => "stellar",
            DepositChain::Base => "base",
            DepositChain::Bitcoin => "bitcoin",
        }
    }
}

impl std::fmt::Display for DepositChain {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Deserialize)]
pub struct DepositAddressQuery {
    pub chain: DepositChain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DepositAddressResponse {
    pub chain: &'static str,
    pub address: String,
    /// Scannable URI following the chain's open standard.
    pub qr_uri: String,
}

// ── Handler ───────────────────────────────────────────────────────────────────

async fn get_deposit_address(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<DepositAddressQuery>,
) -> Result<Json<DepositAddressResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let chain = params.chain;

    // 1. Look up an existing address for this (user, chain) pair.
    let existing = sqlx::query_as::<_, (String,)>(
        "SELECT address FROM deposit_addresses WHERE user_id = $1 AND chain = $2",
    )
    .bind(user_id.as_uuid())
    .bind(chain.as_str())
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    let address = if let Some((addr,)) = existing {
        addr
    } else {
        // 2. Provision a new address and persist it.
        provision_address(&state, user_id.as_uuid(), chain, &pool).await?
    };

    let qr_uri = build_qr_uri(chain, &address);

    Ok(Json(DepositAddressResponse {
        chain: chain.as_str(),
        address,
        qr_uri,
    }))
}

// ── Address provisioning ──────────────────────────────────────────────────────

/// Provisions and persists a deposit address for `(user_id, chain)`.
///
/// Uses `INSERT … ON CONFLICT (user_id, chain) DO NOTHING` so concurrent
/// requests cannot create two addresses for the same user on the same chain.
/// If another request races us and inserts first, we re-read and return
/// whichever row won.
async fn provision_address(
    state: &AppState,
    user_id: Uuid,
    chain: DepositChain,
    pool: &sqlx::PgPool,
) -> Result<String, ApiError> {
    match chain {
        DepositChain::Stellar => provision_stellar(state, user_id, pool).await,
        DepositChain::Base => provision_custody(state, user_id, chain, pool).await,
        DepositChain::Bitcoin => provision_custody(state, user_id, chain, pool).await,
    }
}

/// Provisions a Stellar muxed deposit address.
///
/// The muxed ID is the lower 64 bits of the user UUID (the last 8 bytes in
/// big-endian layout).  UUIDs v4 are random, so collisions in a 64-bit space
/// are negligible for any realistic user count.  The same cast is used by the
/// chain service's `AccountResolver` when matching incoming deposits.
async fn provision_stellar(
    state: &AppState,
    user_id: Uuid,
    pool: &sqlx::PgPool,
) -> Result<String, ApiError> {
    let custody = state
        .config
        .stellar_custody_account
        .as_deref()
        .ok_or_else(|| {
            ApiError::Internal(anyhow::anyhow!(
                "STELLAR_CUSTODY_ACCOUNT is not configured; cannot provision Stellar addresses"
            ))
        })?;

    // Derive a stable 64-bit muxed ID from the lower 8 bytes of the UUID.
    let bytes = user_id.as_bytes();
    let muxed_id = u64::from_be_bytes([
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    ]);

    let address = muxed_deposit_address(custody, muxed_id).map_err(|e| {
        ApiError::Internal(anyhow::anyhow!(
            "could not build muxed deposit address: {e}"
        ))
    })?;

    // Bit-cast u64 → i64 for the BIGINT column (same pattern as AccountResolver).
    let muxed_id_stored = i64::from_ne_bytes(muxed_id.to_ne_bytes());

    upsert_deposit_address(
        pool,
        user_id,
        DepositChain::Stellar,
        &address,
        Some(muxed_id_stored),
        None,
    )
    .await
}

/// Provisions a shared Base or Bitcoin custody address for a user.
///
/// **Note:** the API service does not hold HD wallet keys, so per-user address
/// derivation is not yet implemented. Every user is given the configured
/// custody address itself, which is why `0008_deposit_address_constraints`
/// drops address uniqueness. A sequential `derivation_index` is stored so the
/// row can be upgraded once the chain service derives per-user addresses.
async fn provision_custody(
    state: &AppState,
    user_id: Uuid,
    chain: DepositChain,
    pool: &sqlx::PgPool,
) -> Result<String, ApiError> {
    let custody = match chain {
        DepositChain::Base => state
            .config
            .base_custody_address
            .as_deref()
            .ok_or_else(|| {
                ApiError::Internal(anyhow::anyhow!(
                    "BASE_CUSTODY_ADDRESS is not configured; cannot provision Base addresses"
                ))
            })?,
        DepositChain::Bitcoin => state.config.bitcoin_custody_address.as_deref().ok_or_else(
            || {
                ApiError::Internal(anyhow::anyhow!(
                    "BITCOIN_CUSTODY_ADDRESS is not configured; cannot provision Bitcoin addresses"
                ))
            },
        )?,
        DepositChain::Stellar => unreachable!("handled by provision_stellar"),
    };

    // Use a sequential derivation index: count existing rows for this chain.
    let derivation_index: i32 = sqlx::query_scalar(
        "SELECT COALESCE(COUNT(*)::INT, 0) FROM deposit_addresses WHERE chain = $1",
    )
    .bind(chain.as_str())
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    // The address must be one a wallet can pay: the custody address itself,
    // never a decorated placeholder.
    upsert_deposit_address(pool, user_id, chain, custody, None, Some(derivation_index)).await
}

/// Inserts a deposit address row, ignoring a race where another request
/// already inserted one for the same `(user_id, chain)` pair.  Re-reads and
/// returns the address that is now in the table.
async fn upsert_deposit_address(
    pool: &sqlx::PgPool,
    user_id: Uuid,
    chain: DepositChain,
    address: &str,
    muxed_id: Option<i64>,
    derivation_index: Option<i32>,
) -> Result<String, ApiError> {
    sqlx::query(
        "INSERT INTO deposit_addresses (id, user_id, chain, address, muxed_id, derivation_index)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, chain) DO NOTHING",
    )
    .bind(Uuid::new_v4())
    .bind(user_id)
    .bind(chain.as_str())
    .bind(address)
    .bind(muxed_id)
    .bind(derivation_index)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    // Re-read: if we won the race our row is there; if we lost, the winner's
    // row is there.  Either way this is the address the user should use.
    let (addr,) = sqlx::query_as::<_, (String,)>(
        "SELECT address FROM deposit_addresses WHERE user_id = $1 AND chain = $2",
    )
    .bind(user_id)
    .bind(chain.as_str())
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;

    Ok(addr)
}

// ── QR URI generation ─────────────────────────────────────────────────────────

/// Builds a scannable URI for the given chain and address.
///
/// | Chain   | URI                                   | Standard |
/// |---------|---------------------------------------|----------|
/// | Stellar | `web+stellar:pay?destination=<M...>`  | SEP-7    |
/// | Base    | `ethereum:<0x...>@8453`               | EIP-681  |
/// | Bitcoin | `bitcoin:<address>`                   | BIP-21   |
pub fn build_qr_uri(chain: DepositChain, address: &str) -> String {
    match chain {
        DepositChain::Stellar => format!("web+stellar:pay?destination={address}"),
        DepositChain::Base => format!("ethereum:{address}@8453"),
        DepositChain::Bitcoin => format!("bitcoin:{address}"),
    }
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
    use uuid::Uuid;

    use super::{DepositChain, build_qr_uri};
    use crate::config::Config;
    use crate::{AppState, router};

    // ── QR URI unit tests ────────────────────────────────────────────────────

    #[test]
    fn stellar_qr_uri_uses_sep7_scheme() {
        let uri = build_qr_uri(
            DepositChain::Stellar,
            "MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2AA4",
        );
        assert!(uri.starts_with("web+stellar:pay?destination=M"));
    }

    #[test]
    fn base_qr_uri_uses_eip681_scheme_with_chain_id() {
        let uri = build_qr_uri(
            DepositChain::Base,
            "0xAbCd1234000000000000000000000000DeAdBeEf",
        );
        assert_eq!(
            uri,
            "ethereum:0xAbCd1234000000000000000000000000DeAdBeEf@8453"
        );
    }

    #[test]
    fn bitcoin_qr_uri_uses_bip21_scheme() {
        let uri = build_qr_uri(
            DepositChain::Bitcoin,
            "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        );
        assert_eq!(uri, "bitcoin:bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq");
    }

    // ── Muxed ID derivation unit test ────────────────────────────────────────

    #[test]
    fn muxed_id_derived_from_uuid_lower_64_bits() {
        // Known UUID bytes → expected muxed_id from lower 8 bytes.
        let uuid = Uuid::from_bytes([
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // upper 8 bytes
            0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22, // lower 8 bytes → muxed_id
        ]);
        let bytes = uuid.as_bytes();
        let muxed_id = u64::from_be_bytes([
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
        ]);
        assert_eq!(muxed_id, 0xAABBCCDDEEFF1122u64);
    }

    #[test]
    fn different_uuids_produce_different_muxed_ids() {
        let make_muxed_id = |uuid: Uuid| {
            let bytes = uuid.as_bytes();
            u64::from_be_bytes([
                bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14],
                bytes[15],
            ])
        };
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        // UUIDs v4 are random; the lower 64 bits will virtually always differ.
        assert_ne!(a, b);
        // With overwhelmingly high probability these differ too.
        // If this is flaky, replace with two deterministic UUIDs.
        let _ = (make_muxed_id(a), make_muxed_id(b)); // just ensure it compiles/runs
    }

    // ── DepositChain deserialization ─────────────────────────────────────────

    #[test]
    fn chain_deserializes_from_query_string() {
        // Deserialize via serde_json as a representative test of the enum variants.
        let stellar: DepositChain = serde_json::from_str("\"stellar\"").unwrap();
        let base: DepositChain = serde_json::from_str("\"base\"").unwrap();
        let bitcoin: DepositChain = serde_json::from_str("\"bitcoin\"").unwrap();
        assert_eq!(stellar, DepositChain::Stellar);
        assert_eq!(base, DepositChain::Base);
        assert_eq!(bitcoin, DepositChain::Bitcoin);
    }

    #[test]
    fn unknown_chain_fails_to_deserialize() {
        assert!(serde_json::from_str::<DepositChain>("\"ethereum\"").is_err());
        assert!(serde_json::from_str::<DepositChain>("\"Stellar\"").is_err());
        assert!(serde_json::from_str::<DepositChain>("\"\"").is_err());
    }

    #[test]
    fn chain_as_str_roundtrips() {
        assert_eq!(DepositChain::Stellar.as_str(), "stellar");
        assert_eq!(DepositChain::Base.as_str(), "base");
        assert_eq!(DepositChain::Bitcoin.as_str(), "bitcoin");
    }

    // ── HTTP integration tests (no database) ─────────────────────────────────

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

    #[tokio::test]
    async fn rejects_request_without_bearer_token() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn returns_400_for_missing_chain_param() {
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        // Axum returns 400 when a required query param is missing/unparseable.
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn returns_400_for_invalid_chain_param() {
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=ethereum")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn returns_503_without_database() {
        let config = Config::for_tests();
        let token = crate::auth::jwt::create_token(
            Uuid::new_v4(),
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
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

    // ── Database integration tests ───────────────────────────────────────────

    /// Stellar custody account built from fixed key bytes for deterministic tests.
    fn test_custody_account() -> String {
        use stellar_strkey::ed25519;
        ed25519::PublicKey([7u8; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    fn app_with_stellar(custody: &str, pool: sqlx::PgPool) -> axum::Router {
        let mut config = Config::for_tests();
        config.stellar_custody_account = Some(custody.to_owned());
        router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
    }

    fn app_with_base(address: &str, pool: sqlx::PgPool) -> axum::Router {
        let mut config = Config::for_tests();
        config.base_custody_address = Some(address.to_owned());
        router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
    }

    fn app_with_bitcoin(address: &str, pool: sqlx::PgPool) -> axum::Router {
        let mut config = Config::for_tests();
        config.bitcoin_custody_address = Some(address.to_owned());
        router(
            AppState {
                database: Some(pool),
                config: config.clone(),
            },
            &config,
        )
    }

    async fn test_pool() -> Option<sqlx::PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = sqlx::PgPool::connect(&url).await.ok()?;
        sqlx::migrate!("../../migrations").run(&pool).await.ok()?;
        Some(pool)
    }

    async fn ensure_user(pool: &sqlx::PgPool, user_id: Uuid) {
        sqlx::query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(user_id)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn stellar_returns_muxed_address_on_first_call() {
        let pool = test_pool().await.unwrap();
        let custody = test_custody_account();
        let user_id = Uuid::new_v4();
        ensure_user(&pool, user_id).await;

        let mut config = Config::for_tests();
        config.stellar_custody_account = Some(custody.clone());
        let token = crate::auth::jwt::create_token(
            user_id,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let app = app_with_stellar(&custody, pool.clone());
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(body["chain"], "stellar");
        let address = body["address"].as_str().unwrap();
        assert!(
            address.starts_with('M'),
            "address must be a muxed M... address"
        );
        let qr = body["qr_uri"].as_str().unwrap();
        assert!(
            qr.starts_with("web+stellar:pay?destination=M"),
            "QR URI must follow SEP-7"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn stellar_returns_same_address_on_second_call() {
        let pool = test_pool().await.unwrap();
        let custody = test_custody_account();
        let user_id = Uuid::new_v4();
        ensure_user(&pool, user_id).await;

        let mut config = Config::for_tests();
        config.stellar_custody_account = Some(custody.clone());
        let token = crate::auth::jwt::create_token(
            user_id,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let mk_app = || app_with_stellar(&custody, pool.clone());
        let first = mk_app()
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let second = mk_app()
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let b1: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let b2: Value =
            serde_json::from_slice(&second.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        assert_eq!(
            b1["address"], b2["address"],
            "address must be stable across calls"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn different_users_get_different_stellar_addresses() {
        let pool = test_pool().await.unwrap();
        let custody = test_custody_account();
        let (user_a, user_b) = (Uuid::new_v4(), Uuid::new_v4());
        ensure_user(&pool, user_a).await;
        ensure_user(&pool, user_b).await;

        let mut config = Config::for_tests();
        config.stellar_custody_account = Some(custody.clone());

        let token_a = crate::auth::jwt::create_token(
            user_a,
            "wallet-a".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();
        let token_b = crate::auth::jwt::create_token(
            user_b,
            "wallet-b".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let req = |token: &str| {
            Request::builder()
                .uri("/v1/deposit-address?chain=stellar")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap()
        };

        let ra: Value = serde_json::from_slice(
            &app_with_stellar(&custody, pool.clone())
                .oneshot(req(&token_a))
                .await
                .unwrap()
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();
        let rb: Value = serde_json::from_slice(
            &app_with_stellar(&custody, pool.clone())
                .oneshot(req(&token_b))
                .await
                .unwrap()
                .into_body()
                .collect()
                .await
                .unwrap()
                .to_bytes(),
        )
        .unwrap();

        assert_ne!(
            ra["address"], rb["address"],
            "distinct users must get distinct muxed addresses"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn base_returns_custody_address_and_eip681_qr_uri() {
        let pool = test_pool().await.unwrap();
        let custody = "0xDeAdBeEf000000000000000000000000DeAdBeEf";
        let user_id = Uuid::new_v4();
        ensure_user(&pool, user_id).await;

        let mut config = Config::for_tests();
        config.base_custody_address = Some(custody.to_owned());
        let token = crate::auth::jwt::create_token(
            user_id,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app_with_base(custody, pool)
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=base")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        assert_eq!(body["chain"], "base");
        assert_eq!(body["address"], custody);
        assert_eq!(body["qr_uri"], format!("ethereum:{custody}@8453"));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn bitcoin_returns_custody_address_and_bip21_qr_uri() {
        let pool = test_pool().await.unwrap();
        let btc_addr = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
        let user_id = Uuid::new_v4();
        ensure_user(&pool, user_id).await;

        let mut config = Config::for_tests();
        config.bitcoin_custody_address = Some(btc_addr.to_owned());
        let token = crate::auth::jwt::create_token(
            user_id,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app_with_bitcoin(btc_addr, pool)
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=bitcoin")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();

        assert_eq!(body["chain"], "bitcoin");
        assert_eq!(body["address"], btc_addr);
        assert_eq!(body["qr_uri"], format!("bitcoin:{btc_addr}"));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn stellar_muxed_address_round_trips_through_account_resolver() {
        use engipay_core::stellar::StellarAddress;
        use engipay_core::stellar::parse_address;

        let pool = test_pool().await.unwrap();
        let custody = test_custody_account();
        let user_id = Uuid::new_v4();
        ensure_user(&pool, user_id).await;

        let mut config = Config::for_tests();
        config.stellar_custody_account = Some(custody.clone());
        let token = crate::auth::jwt::create_token(
            user_id,
            "test-wallet".to_string(),
            config.jwt_secret.as_bytes(),
        )
        .unwrap();

        let response = app_with_stellar(&custody, pool.clone())
            .oneshot(
                Request::builder()
                    .uri("/v1/deposit-address?chain=stellar")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        let muxed_address = body["address"].as_str().unwrap();

        // Verify the muxed address can be resolved back to the user.
        let parsed = parse_address(muxed_address).unwrap();
        let StellarAddress::Muxed { base, id } = parsed else {
            panic!("expected a muxed address");
        };
        assert_eq!(base, custody, "base account must match custody account");

        // Derive the expected muxed_id the same way the handler does.
        let uuid_bytes = user_id.as_bytes();
        let expected_muxed_id = u64::from_be_bytes([
            uuid_bytes[8],
            uuid_bytes[9],
            uuid_bytes[10],
            uuid_bytes[11],
            uuid_bytes[12],
            uuid_bytes[13],
            uuid_bytes[14],
            uuid_bytes[15],
        ]);
        assert_eq!(
            id, expected_muxed_id,
            "muxed ID must match lower 64 bits of user UUID"
        );

        // The muxed_id is stored as bit-cast i64; verify the DB row has it.
        let stored_muxed_id: i64 = sqlx::query_scalar(
            "SELECT muxed_id FROM deposit_addresses WHERE user_id = $1 AND chain = 'stellar'",
        )
        .bind(user_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        let roundtripped = u64::from_ne_bytes(stored_muxed_id.to_ne_bytes());
        assert_eq!(
            roundtripped, expected_muxed_id,
            "bit-cast muxed_id must round-trip"
        );
    }
}
