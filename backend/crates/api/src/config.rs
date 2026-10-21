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
    /// Identifier of the current Ed25519 key used to sign transaction receipts
    /// (`RECEIPT_SIGNING_KEY_ID`). Embedded in every receipt so verifiers can
    /// pick the matching public key.
    pub receipt_signing_key_id: String,
    /// Current Ed25519 secret key used to sign receipts (`RECEIPT_SIGNING_KEY`),
    /// encoded as base64 or hex. When unset, receipts cannot be issued.
    pub receipt_signing_key: Option<String>,
    /// Historical public keys `(key_id, public_key)` kept so receipts signed
    /// before a key rotation remain verifiable (`RECEIPT_PUBLIC_KEYS`, formatted
    /// as `keyid:base64pubkey,keyid2:base64pubkey2`).
    pub receipt_historical_public_keys: Vec<(String, String)>,
    /// Stellar Anchor URL for SEP-24 deposits and withdrawals (e.g. "https://testanchor.stellar.org").
    pub stellar_anchor_url: String,
    /// Stellar Anchor home domain for SEP-10 authentication (e.g. "testanchor.stellar.org").
    pub stellar_anchor_home_domain: String,
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

        let receipt_signing_key_id = match env::var("RECEIPT_SIGNING_KEY_ID") {
            Ok(value) if !value.trim().is_empty() => value.trim().to_owned(),
            _ => "receipt-key-1".to_owned(),
        };

        let receipt_signing_key = env::var("RECEIPT_SIGNING_KEY")
            .ok()
            .filter(|key| !key.trim().is_empty())
            .map(|key| key.trim().to_owned());

        let receipt_historical_public_keys = match env::var("RECEIPT_PUBLIC_KEYS") {
            Ok(value) if !value.trim().is_empty() => value
                .split(',')
                .map(|entry| entry.trim())
                .filter(|entry| !entry.is_empty())
                .map(|entry| {
                    let (key_id, public_key) = entry.split_once(':').ok_or_else(|| ConfigError {
                        name: "RECEIPT_PUBLIC_KEYS",
                        reason: format!(
                            "expected `keyid:base64pubkey` entries, got {entry:?}"
                        ),
                    })?;
                    let key_id = key_id.trim();
                    let public_key = public_key.trim();
                    if key_id.is_empty() || public_key.is_empty() {
                        return Err(ConfigError {
                            name: "RECEIPT_PUBLIC_KEYS",
                            reason: format!(
                                "expected non-empty `keyid:base64pubkey` entries, got {entry:?}"
                            ),
                        });
                    }
                    Ok((key_id.to_owned(), public_key.to_owned()))
                })
                .collect::<Result<Vec<_>, ConfigError>>()?,
            _ => Vec::new(),
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
            receipt_signing_key_id,
            receipt_signing_key,
            receipt_historical_public_keys,
            stellar_anchor_url: env::var("STELLAR_ANCHOR_URL")
                .unwrap_or_else(|_| "https://testanchor.stellar.org".to_owned()),
            stellar_anchor_home_domain: env::var("STELLAR_ANCHOR_HOME_DOMAIN")
                .unwrap_or_else(|_| "testanchor.stellar.org".to_owned()),
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
            receipt_signing_key_id: "test-receipt-key".to_owned(),
            // Deterministic Ed25519 test keypair (seed of 32 zero bytes) so
            // tests can both sign and verify receipts. Never use in production.
            receipt_signing_key: Some(
                "nWGxne/9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A=".to_owned(),
            ),
            receipt_historical_public_keys: vec![(
                "test-receipt-key".to_owned(),
                "11qYAYKxCrfVS/7TyWQHOg7hcvPapiMlrwIaaPcHURo=".to_owned(),
            )],
            stellar_anchor_url: "https://testanchor.stellar.org".to_owned(),
            stellar_anchor_home_domain: "testanchor.stellar.org".to_owned(),
        }
    }
}
