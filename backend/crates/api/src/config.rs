use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: String,
    pub database_url: Option<String>,
    pub db_max_connections: u32,
    pub allowed_origins: Vec<String>,
    pub json_logs: bool,
    pub stellar_server_secret: Option<String>,
    /// HMAC-SHA256 signing key for session JWTs (see `auth::jwt`).
    pub jwt_secret: String,
    /// The custody account on Stellar (`G...`). Users get a unique muxed `M...`
    /// address derived from it. When unset the Stellar deposit-address endpoint
    /// returns 503.
    pub stellar_custody_account: Option<String>,
    /// Shared Base (EVM) custody address (`0x...`). When unset the Base
    /// deposit-address endpoint returns 503.
    pub base_custody_address: Option<String>,
    /// Shared Bitcoin custody address. When unset the Bitcoin deposit-address
    /// endpoint returns 503.
    pub bitcoin_custody_address: Option<String>,
    /// Daily transaction limit for tier 0 (in USDC minor units, 7 decimals).
    /// Higher tiers scale by (tier + 1). Default: 500 USDC.
    pub tier_0_daily_limit_minor: i128,
    /// Kobo that buy one whole USDC, for Naira buy quotes (`BUY_KOBO_PER_USDC`).
    /// Unset means no quote can be made: the rate is never invented.
    pub buy_kobo_per_usdc: Option<i128>,
    /// Fee on Naira buys in basis points (`BUY_FEE_BPS`). Unset means no quote.
    pub buy_fee_bps: Option<u32>,
    /// Ed25519 receipt signing key as a 64-character hex string, optionally
    /// prefixed with a key-id (`"v1:aabbcc…"`). When unset receipts are
    /// returned without a signature.
    pub receipt_signing_key: Option<String>,
    /// Comma-separated list of retired Ed25519 public keys for verifying
    /// receipts signed before the last key rotation. Each entry is
    /// `kid:hex_public_key` (e.g. `"v1:aabb…,v0:ccdd…"`). Private keys are
    /// never needed here — only public keys are required so old receipts can
    /// still be verified. When empty, only the current key is published.
    pub receipt_retired_keys: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
#[error("{name} is invalid: {reason}")]
pub struct ConfigError {
    name: &'static str,
    reason: String,
}

impl Config {
    /// Reads configuration from the environment. Secrets such as the database
    /// password arrive this way and are never written to the repository.
    pub fn from_env() -> Result<Self, ConfigError> {
        let db_max_connections = match env::var("DB_MAX_CONNECTIONS") {
            Ok(value) => value.parse().map_err(|_| ConfigError {
                name: "DB_MAX_CONNECTIONS",
                reason: format!("expected a whole number, got {value:?}"),
            })?,
            Err(_) => 10,
        };

        let tier_0_daily_limit_minor = match env::var("TIER_0_DAILY_LIMIT_MINOR") {
            Ok(value) => value.parse().map_err(|_| ConfigError {
                name: "TIER_0_DAILY_LIMIT_MINOR",
                reason: format!("expected a whole number, got {value:?}"),
            })?,
            Err(_) => 500 * 10_000_000, // Default: 500 USDC
        };

        let buy_kobo_per_usdc = match env::var("BUY_KOBO_PER_USDC") {
            Ok(value) if !value.trim().is_empty() => {
                Some(value.trim().parse().map_err(|_| ConfigError {
                    name: "BUY_KOBO_PER_USDC",
                    reason: format!("expected a whole number of kobo, got {value:?}"),
                })?)
            }
            _ => None,
        };

        let buy_fee_bps = match env::var("BUY_FEE_BPS") {
            Ok(value) if !value.trim().is_empty() => {
                Some(value.trim().parse().map_err(|_| ConfigError {
                    name: "BUY_FEE_BPS",
                    reason: format!("expected basis points (0-9999), got {value:?}"),
                })?)
            }
            _ => None,
        };

        Ok(Self {
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_owned()),
            database_url: env::var("DATABASE_URL")
                .ok()
                .filter(|url| !url.trim().is_empty()),
            db_max_connections,
            allowed_origins: env::var("ALLOWED_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:3000".to_owned())
                .split(',')
                .map(|origin| origin.trim().to_owned())
                .filter(|origin| !origin.is_empty())
                .collect(),
            json_logs: env::var("LOG_FORMAT")
                .is_ok_and(|format| format.eq_ignore_ascii_case("json")),
            stellar_server_secret: env::var("STELLAR_SERVER_SECRET").ok(),
            jwt_secret: env::var("JWT_SECRET").map_err(|_| ConfigError {
                name: "JWT_SECRET",
                reason: "must be set to a random secret used to sign session tokens".to_owned(),
            })?,
            stellar_custody_account: env::var("STELLAR_CUSTODY_ACCOUNT")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            base_custody_address: env::var("BASE_CUSTODY_ADDRESS")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            bitcoin_custody_address: env::var("BITCOIN_CUSTODY_ADDRESS")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            tier_0_daily_limit_minor,
            buy_kobo_per_usdc,
            buy_fee_bps,
            receipt_signing_key: env::var("RECEIPT_SIGNING_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty()),
            receipt_retired_keys: env::var("RECEIPT_RETIRED_KEYS")
                .ok()
                .map(|s| {
                    s.split(',')
                        .map(|e| e.trim().to_owned())
                        .filter(|e| !e.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
        })
    }

    /// A configuration for tests: no database, the local web origin.
    pub fn for_tests() -> Self {
        Self {
            bind_addr: "127.0.0.1:0".to_owned(),
            database_url: None,
            db_max_connections: 1,
            allowed_origins: vec!["http://localhost:3000".to_owned()],
            json_logs: false,
            stellar_server_secret: None,
            jwt_secret: "test-secret-do-not-use-in-production".to_owned(),
            stellar_custody_account: None,
            base_custody_address: None,
            bitcoin_custody_address: None,
            tier_0_daily_limit_minor: 500 * 10_000_000,
            buy_kobo_per_usdc: None,
            buy_fee_bps: None,
            receipt_signing_key: None,
            receipt_retired_keys: vec![],
        }
    }
}
