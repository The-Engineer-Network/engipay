//! Linking wallets to one account, end to end against a real Postgres.
//!
//! Needs DATABASE_URL pointing at a database with every migration applied, so
//! it is ignored by default. Run it with:
//!   DATABASE_URL=postgres://... cargo test -p engipay-api --test wallets_db -- --ignored

#![allow(clippy::unwrap_used)]

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use engipay_api::auth::jwt::create_token;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::{AppState, config::Config, router};
use http_body_util::BodyExt;
use k256::ecdsa::SigningKey;
use serde_json::{Value, json};
use sha3::{Digest, Keccak256};
use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;
use uuid::Uuid;

async fn setup() -> (axum::Router, PgPool) {
    let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
    let pool = PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await
        .unwrap();
    let config = Config::for_tests();
    let app = router(
        AppState::with_fakes(Some(pool.clone()), config.clone(), RateLimiter::new()),
        &config,
    );
    (app, pool)
}

/// An EVM wallet we control in the test.
struct Wallet {
    key: SigningKey,
    address: String,
}

impl Wallet {
    fn new(seed: u8) -> Self {
        let key = SigningKey::from_slice(&[seed; 32]).unwrap();
        let point = key.verifying_key().to_encoded_point(false);
        let digest = Keccak256::digest(&point.as_bytes()[1..]);
        let address = format!("0x{}", hex::encode(&digest[12..]));
        Self { key, address }
    }

    /// A SIWE-style message for `nonce`, signed with EIP-191 framing.
    fn sign(&self, nonce: &str) -> (String, String) {
        let message = format!(
            "Sign in to EngiPay\nAddress: {}\nNonce: {nonce}",
            self.address
        );
        let prefixed = format!("\x19Ethereum Signed Message:\n{}{message}", message.len());
        let digest = Keccak256::digest(prefixed.as_bytes());
        let (signature, recovery) = self.key.sign_prehash_recoverable(&digest).unwrap();
        let mut bytes = signature.to_bytes().to_vec();
        bytes.push(recovery.to_byte());
        (message, format!("0x{}", hex::encode(bytes)))
    }
}

async fn fresh_nonce(pool: &PgPool) -> String {
    let nonce = Uuid::new_v4().simple().to_string();
    sqlx::query(
        "INSERT INTO auth_nonces (nonce, expires_at) VALUES ($1, now() + interval '5 minutes')",
    )
    .bind(&nonce)
    .execute(pool)
    .await
    .unwrap();
    nonce
}

/// An account with a first (sign-in) wallet, and a session token for it.
async fn account(pool: &PgPool, first_wallet: Option<&str>) -> (Uuid, String) {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO users (id, wallet_address) VALUES ($1, $2)")
        .bind(id)
        .bind(first_wallet)
        .execute(pool)
        .await
        .unwrap();
    let token = create_token(id, String::new(), Config::for_tests().jwt_secret.as_bytes()).unwrap();
    (id, token)
}

async fn send(
    app: &axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    let body = match body {
        Some(json) => {
            builder = builder.header(header::CONTENT_TYPE, "application/json");
            Body::from(json.to_string())
        }
        None => Body::empty(),
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Links `wallet` to the account behind `token`, with a fresh nonce and signature.
async fn link(
    app: &axum::Router,
    pool: &PgPool,
    token: &str,
    wallet: &Wallet,
) -> (StatusCode, Value) {
    let nonce = fresh_nonce(pool).await;
    let (message, signature) = wallet.sign(&nonce);
    send(
        app,
        "POST",
        "/v1/wallets",
        Some(token),
        Some(json!({
            "chain": "evm",
            "address": wallet.address,
            "message": message,
            "signature": signature,
        })),
    )
    .await
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_linked_wallet_signs_in_to_the_same_account() {
    let (app, pool) = setup().await;
    let (owner, token) = account(&pool, Some(&Wallet::new(1).address)).await;
    let second = Wallet::new(2);

    let (status, _) = link(&app, &pool, &token, &second).await;
    assert_eq!(status, StatusCode::CREATED);

    // Sign in with the second wallet: it must land on the same account.
    let nonce = fresh_nonce(&pool).await;
    let (message, signature) = second.sign(&nonce);
    let (status, body) = send(
        &app,
        "POST",
        "/v1/auth/verify-evm",
        None,
        Some(json!({ "message": message, "signature": signature, "address": second.address })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["user_id"], owner.to_string());
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn linking_the_same_wallet_twice_is_refused() {
    let (app, pool) = setup().await;
    let (_, token) = account(&pool, Some(&Wallet::new(3).address)).await;
    let wallet = Wallet::new(4);

    assert_eq!(
        link(&app, &pool, &token, &wallet).await.0,
        StatusCode::CREATED
    );
    let (status, body) = link(&app, &pool, &token, &wallet).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.to_string().contains("already linked to your account"));
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_wallet_linked_to_another_account_cannot_be_linked_here() {
    let (app, pool) = setup().await;
    let wallet = Wallet::new(5);
    let (_, owner_token) = account(&pool, Some(&Wallet::new(6).address)).await;
    let (_, other_token) = account(&pool, Some(&Wallet::new(7).address)).await;
    assert_eq!(
        link(&app, &pool, &owner_token, &wallet).await.0,
        StatusCode::CREATED
    );

    let (status, body) = link(&app, &pool, &other_token, &wallet).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.to_string().contains("another account"));
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_nonce_cannot_be_used_to_link_twice() {
    let (app, pool) = setup().await;
    let (_, token) = account(&pool, Some(&Wallet::new(8).address)).await;
    let wallet = Wallet::new(9);
    let nonce = fresh_nonce(&pool).await;
    let (message, signature) = wallet.sign(&nonce);
    let body = json!({ "chain": "evm", "address": wallet.address, "message": message, "signature": signature });

    assert_eq!(
        send(
            &app,
            "POST",
            "/v1/wallets",
            Some(&token),
            Some(body.clone())
        )
        .await
        .0,
        StatusCode::CREATED
    );
    let (status, _) = send(&app, "POST", "/v1/wallets", Some(&token), Some(body)).await;
    assert_eq!(
        status,
        StatusCode::UNAUTHORIZED,
        "the nonce is spent after one use"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn removal_is_scheduled_then_takes_effect_after_the_cooldown() {
    let (app, pool) = setup().await;
    let (_, token) = account(&pool, Some(&Wallet::new(10).address)).await;
    let wallet = Wallet::new(11);
    assert_eq!(
        link(&app, &pool, &token, &wallet).await.0,
        StatusCode::CREATED
    );
    let wallet_id: Uuid = sqlx::query_scalar("SELECT id FROM user_wallets WHERE address = $1")
        .bind(&wallet.address)
        .fetch_one(&pool)
        .await
        .unwrap();

    let (status, body) = send(
        &app,
        "DELETE",
        &format!("/v1/wallets/{wallet_id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert!(body["removal_effective_at"].is_string());

    // Still listed, marked as scheduled, until the cooldown passes.
    let (_, list) = send(&app, "GET", "/v1/wallets", Some(&token), None).await;
    let scheduled = list
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["id"] == wallet_id.to_string())
        .expect("still listed during the cooldown");
    assert_eq!(scheduled["status"], "removal_scheduled");

    // Advance past the cooldown: the wallet drops out of the list.
    sqlx::query(
        "UPDATE user_wallets SET removal_effective_at = now() - interval '1 second' WHERE id = $1",
    )
    .bind(wallet_id)
    .execute(&pool)
    .await
    .unwrap();
    let (_, list) = send(&app, "GET", "/v1/wallets", Some(&token), None).await;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .all(|w| w["id"] != wallet_id.to_string()),
        "a removed wallet is no longer listed"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn the_only_sign_in_method_cannot_be_removed() {
    let (app, pool) = setup().await;
    // An account with no first wallet, so its one linked wallet is its only method.
    let (_, token) = account(&pool, None).await;
    let wallet = Wallet::new(12);
    assert_eq!(
        link(&app, &pool, &token, &wallet).await.0,
        StatusCode::CREATED
    );
    let wallet_id: Uuid = sqlx::query_scalar("SELECT id FROM user_wallets WHERE address = $1")
        .bind(&wallet.address)
        .fetch_one(&pool)
        .await
        .unwrap();

    let (status, body) = send(
        &app,
        "DELETE",
        &format!("/v1/wallets/{wallet_id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.to_string().contains("only sign-in method"));
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn removing_a_wallet_twice_is_refused() {
    let (app, pool) = setup().await;
    let (_, token) = account(&pool, Some(&Wallet::new(13).address)).await;
    let wallet = Wallet::new(14);
    assert_eq!(
        link(&app, &pool, &token, &wallet).await.0,
        StatusCode::CREATED
    );
    let wallet_id: Uuid = sqlx::query_scalar("SELECT id FROM user_wallets WHERE address = $1")
        .bind(&wallet.address)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        send(
            &app,
            "DELETE",
            &format!("/v1/wallets/{wallet_id}"),
            Some(&token),
            None
        )
        .await
        .0,
        StatusCode::ACCEPTED
    );
    let (status, _) = send(
        &app,
        "DELETE",
        &format!("/v1/wallets/{wallet_id}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}
