//! Stellar: deposits into muxed custody addresses, and payments out.
//!
//! Talks to Horizon over HTTPS. Horizon only reads the chain and relays signed
//! transactions; it never sees a key.

pub mod cursor;
pub mod horizon;
pub mod network;
pub mod payment;

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use engipay_core::Chain;
use engipay_core::stellar::{StellarAddress, parse_address};
use tracing::{error, warn};

use self::horizon::{Account, Page, PaymentRecord, Root, SubmitProblem, Submitted};
pub use self::network::StellarNetwork;
use self::payment::{PaymentRequest, StellarSigner};
use crate::{ChainClient, ChainError, ObservedDeposit};

/// Records per Horizon page, the maximum it allows.
const PAGE_LIMIT: usize = 200;
/// Pages read per call, so one poll cannot run unbounded after downtime. The
/// caller resumes from the last ledger it saw.
const MAX_PAGES: usize = 25;
/// How long a signed payment stays valid if it does not land.
const PAYMENT_VALIDITY: Duration = Duration::from_secs(120);

#[derive(Debug, Clone)]
pub struct StellarConfig {
    pub network: StellarNetwork,
    pub horizon_url: String,
    /// The custody account deposits arrive in, `G...`.
    pub custody_account: String,
}

impl StellarConfig {
    pub fn new(
        network: StellarNetwork,
        horizon_url: Option<String>,
        custody_account: &str,
    ) -> Result<Self, ChainError> {
        match parse_address(custody_account) {
            Ok(StellarAddress::Account(account)) => Ok(Self {
                network,
                horizon_url: horizon_url
                    .filter(|url| !url.trim().is_empty())
                    .unwrap_or_else(|| network.default_horizon_url().to_owned())
                    .trim_end_matches('/')
                    .to_owned(),
                custody_account: account,
            }),
            _ => Err(ChainError::Config(
                "the Stellar custody account must be a plain G... address".to_owned(),
            )),
        }
    }
}

pub struct StellarClient {
    config: StellarConfig,
    http: reqwest::Client,
}

impl StellarClient {
    pub fn new(config: StellarConfig) -> Result<Self, ChainError> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("engipay-chain/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| ChainError::Unavailable(error.to_string()))?;
        Ok(Self { config, http })
    }

    pub fn config(&self) -> &StellarConfig {
        &self.config
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, ChainError> {
        self.get_with_retry(path, 0).await
    }

    async fn get_with_retry<T: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        attempt: u32,
    ) -> Result<T, ChainError> {
        const MAX_RETRIES: u32 = 5;
        const INITIAL_DELAY_MS: u64 = 500;
        const MAX_DELAY_MS: u64 = 30_000;

        let url = format!("{}{path}", self.config.horizon_url);
        let response = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|error| ChainError::Unavailable(error.to_string()))?;
        let status = response.status();

        if status.is_success() {
            return response.json().await.map_err(|error| {
                ChainError::Unavailable(format!("unexpected Horizon response: {error}"))
            });
        }

        let is_retryable = matches!(status.as_u16(), 429 | 502 | 503 | 504);
        if !is_retryable || attempt >= MAX_RETRIES {
            return Err(ChainError::Unavailable(format!(
                "Horizon returned {status} for {path}"
            )));
        }

        let jittered_delay = backoff_delay_ms(attempt, INITIAL_DELAY_MS, MAX_DELAY_MS);

        warn!(
            status = status.as_u16(),
            attempt = attempt.saturating_add(1),
            max_retries = MAX_RETRIES,
            delay_ms = jittered_delay,
            "Horizon returned transient error, retrying"
        );

        tokio::time::sleep(Duration::from_millis(jittered_delay)).await;
        // Boxed: an async fn that calls itself needs indirection to have a
        // finite size.
        Box::pin(self.get_with_retry(path, attempt.saturating_add(1))).await
    }

    /// The account's current sequence number.
    pub async fn sequence(&self, account: &str) -> Result<i64, ChainError> {
        let account: Account = self.get(&format!("/accounts/{account}")).await?;
        account
            .sequence
            .parse()
            .map_err(|_| ChainError::Unavailable("Horizon returned a bad sequence".to_owned()))
    }

    /// Builds, signs and submits a payment from the signer's account. Returns
    /// the transaction hash once the network has accepted it into a ledger.
    pub async fn send_payment(
        &self,
        signer: &dyn StellarSigner,
        request: &PaymentRequest,
    ) -> Result<String, ChainError> {
        let source = signer.account();
        let sequence = self.sequence(&source).await?;
        let valid_until = SystemTime::now()
            .checked_add(PAYMENT_VALIDITY)
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|elapsed| elapsed.as_secs())
            .ok_or_else(|| ChainError::Config("system clock is before 1970".to_owned()))?;

        let transaction = payment::build_payment(
            &signer.public_key(),
            sequence,
            request,
            self.config.network,
            valid_until,
        )
        .map_err(|error| ChainError::Rejected(error.to_string()))?;
        let (envelope, _) = payment::sign(transaction, signer, self.config.network)
            .map_err(|error| ChainError::Rejected(error.to_string()))?;
        let encoded = payment::envelope_base64(&envelope)
            .map_err(|error| ChainError::Rejected(error.to_string()))?;

        self.submit_payment_with_retry(&encoded, 0).await
    }

    async fn submit_payment_with_retry(
        &self,
        encoded: &str,
        attempt: u32,
    ) -> Result<String, ChainError> {
        const MAX_RETRIES: u32 = 5;
        const INITIAL_DELAY_MS: u64 = 500;
        const MAX_DELAY_MS: u64 = 30_000;

        let response = self
            .http
            .post(format!("{}/transactions", self.config.horizon_url))
            .form(&[("tx", encoded)])
            .send()
            .await
            .map_err(|error| ChainError::Unavailable(error.to_string()))?;

        let status = response.status();
        if status.is_success() {
            let submitted: Submitted = response
                .json()
                .await
                .map_err(|error| ChainError::Unavailable(error.to_string()))?;
            tracing::info!(hash = %submitted.hash, ledger = submitted.ledger, "stellar payment landed");
            return Ok(submitted.hash);
        }

        let is_retryable = matches!(status.as_u16(), 429 | 502 | 503 | 504);
        if !is_retryable || attempt >= MAX_RETRIES {
            let problem: Option<SubmitProblem> = response.json().await.ok();
            let detail = problem.map_or_else(
                || status.to_string(),
                |problem| match problem.extras.and_then(|extras| extras.result_codes) {
                    Some(codes) => format!("{}: {codes}", problem.title),
                    None => problem.title,
                },
            );
            return Err(ChainError::Rejected(detail));
        }

        let jittered_delay = backoff_delay_ms(attempt, INITIAL_DELAY_MS, MAX_DELAY_MS);

        warn!(
            status = status.as_u16(),
            attempt = attempt.saturating_add(1),
            max_retries = MAX_RETRIES,
            delay_ms = jittered_delay,
            "Horizon returned transient error on payment submission, retrying"
        );

        tokio::time::sleep(Duration::from_millis(jittered_delay)).await;
        Box::pin(self.submit_payment_with_retry(encoded, attempt.saturating_add(1))).await
    }
}

impl ChainClient for StellarClient {
    fn chain(&self) -> Chain {
        Chain::Stellar
    }

    async fn latest_height(&self) -> Result<u64, ChainError> {
        let root: Root = self.get("/").await?;
        Ok(root.history_latest_ledger)
    }

    /// Deposits into the custody account from ledger `height` onwards.
    async fn deposits_since(&self, height: u64) -> Result<Vec<ObservedDeposit>, ChainError> {
        let latest = self.latest_height().await?;
        let mut cursor = horizon::cursor_for_ledger(height)
            .ok_or_else(|| ChainError::Unavailable("ledger height out of range".to_owned()))?
            .to_string();
        let mut deposits = Vec::new();

        for _ in 0..MAX_PAGES {
            let page: Page<PaymentRecord> = self
                .get(&format!(
                    "/accounts/{}/payments?join=transactions&order=asc&limit={PAGE_LIMIT}&cursor={cursor}",
                    self.config.custody_account
                ))
                .await?;
            let records = page.embedded.records;
            let full_page = records.len() == PAGE_LIMIT;

            for record in &records {
                match horizon::deposit_from_record(
                    record,
                    &self.config.custody_account,
                    self.config.network,
                    latest,
                ) {
                    Ok(deposit) => deposits.push(deposit),
                    Err(horizon::Skipped::NotIncoming) => {}
                    Err(reason) => {
                        let is_security_sensitive = reason.is_security_sensitive();
                        if is_security_sensitive {
                            error!(
                                transaction = %record.transaction_hash,
                                operation = %record.paging_token,
                                from = ?record.from,
                                to = ?record.to,
                                to_muxed = ?record.to_muxed,
                                asset_code = ?record.asset_code,
                                asset_issuer = ?record.asset_issuer,
                                amount = ?record.amount,
                                ?reason,
                                "SECURITY: unauthorized asset transferred to custody; quarantined for review"
                            );
                        } else {
                            warn!(
                                transaction = %record.transaction_hash,
                                operation = %record.paging_token,
                                ?reason,
                                "stellar payment into custody was not credited"
                            );
                        }
                    }
                }
            }

            match records.last() {
                Some(last) if full_page => cursor.clone_from(&last.paging_token),
                _ => break,
            }
        }
        Ok(deposits)
    }
}

/// Exponential backoff with a little jitter, in milliseconds.
///
/// Integer arithmetic only: the workspace denies operations that can overflow
/// or truncate silently, and a retry delay is not worth a panic.
fn backoff_delay_ms(attempt: u32, initial_ms: u64, max_ms: u64) -> u64 {
    let delay = initial_ms
        .checked_mul(1u64.checked_shl(attempt.min(16)).unwrap_or(u64::MAX))
        .unwrap_or(max_ms)
        .min(max_ms);
    // Spread retries out by up to a tenth of the delay, so several callers
    // waiting on the same outage do not return at the same instant.
    let spread = delay.checked_div(10).unwrap_or(0);
    let offset = u64::from(attempt)
        .wrapping_mul(2_654_435_761)
        .checked_rem(spread.saturating_add(1))
        .unwrap_or(0);
    // Clamped again: the jitter must never push a delay past the ceiling.
    delay
        .saturating_sub(spread.checked_div(2).unwrap_or(0))
        .saturating_add(offset)
        .min(max_ms)
}

#[cfg(test)]
mod backoff_tests {
    use super::backoff_delay_ms;

    #[test]
    fn grows_with_each_attempt_and_stops_at_the_ceiling() {
        let first = backoff_delay_ms(0, 500, 30_000);
        let second = backoff_delay_ms(1, 500, 30_000);
        assert!(first < second, "{first} < {second}");
        for attempt in 0..40 {
            assert!(backoff_delay_ms(attempt, 500, 30_000) <= 30_000);
        }
    }

    #[test]
    fn never_overflows_on_absurd_attempts() {
        assert!(backoff_delay_ms(u32::MAX, u64::MAX, 30_000) <= 30_000);
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use engipay_core::{Asset, Money};

    fn account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    async fn client(server: &MockServer) -> StellarClient {
        let config =
            StellarConfig::new(StellarNetwork::Testnet, Some(server.uri()), &account(1)).unwrap();
        StellarClient::new(config).unwrap()
    }

    #[test]
    fn custody_must_be_a_plain_account() {
        let muxed = engipay_core::stellar::muxed_deposit_address(&account(1), 5).unwrap();
        assert!(StellarConfig::new(StellarNetwork::Testnet, None, &muxed).is_err());
        assert!(StellarConfig::new(StellarNetwork::Testnet, None, "nope").is_err());
        let config = StellarConfig::new(StellarNetwork::Testnet, None, &account(1)).unwrap();
        assert_eq!(config.horizon_url, "https://horizon-testnet.stellar.org");
    }

    #[tokio::test]
    async fn reads_deposits_from_the_ledger_cursor() {
        let server = MockServer::start().await;
        let custody = account(1);
        let muxed = engipay_core::stellar::muxed_deposit_address(&custody, 9).unwrap();

        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "history_latest_ledger": 50 })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!("/accounts/{custody}/payments")))
            .and(query_param("cursor", (48i64 << 32).to_string()))
            .and(query_param("join", "transactions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "_embedded": { "records": [
                    {
                        "paging_token": "206158434305",
                        "type": "payment",
                        "transaction_hash": "feed",
                        "transaction_successful": true,
                        "to": custody,
                        "to_muxed": muxed,
                        "asset_type": "native",
                        "amount": "4.0000000",
                        "transaction": { "ledger": 48, "successful": true }
                    },
                    {
                        "paging_token": "206158434306",
                        "type": "payment",
                        "transaction_hash": "beef",
                        "transaction_successful": true,
                        "to": custody,
                        "asset_type": "credit_alphanum4",
                        "asset_code": "USDC",
                        "asset_issuer": account(3),
                        "amount": "4.0000000",
                        "transaction": { "ledger": 48, "successful": true }
                    }
                ]}
            })))
            .mount(&server)
            .await;

        let deposits = client(&server).await.deposits_since(48).await.unwrap();
        assert_eq!(deposits.len(), 1, "fake USDC must not be credited");
        assert_eq!(deposits[0].money, Money::from_minor(Asset::Xlm, 40_000_000));
        assert_eq!(deposits[0].address, muxed);
        assert_eq!(deposits[0].confirmations, 3);
    }

    #[tokio::test]
    async fn horizon_errors_surface_as_unavailable() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        let result = client(&server).await.latest_height().await;
        assert!(matches!(result, Err(ChainError::Unavailable(_))));
    }

    #[tokio::test]
    async fn rejected_payments_report_horizon_result_codes() {
        let server = MockServer::start().await;
        let signer = payment::LocalTestnetSigner::from_secret(
            stellar_strkey::ed25519::PrivateKey([4; 32])
                .as_unredacted()
                .to_string()
                .as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap();

        Mock::given(method("GET"))
            .and(path(format!("/accounts/{}", signer.account())))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "sequence": "100" })),
            )
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "title": "Transaction Failed",
                "extras": { "result_codes": { "transaction": "tx_failed", "operations": ["op_underfunded"] } }
            })))
            .mount(&server)
            .await;

        let request = PaymentRequest {
            destination: account(2),
            money: Money::parse(Asset::Xlm, "1").unwrap(),
        };
        let error = client(&server)
            .await
            .send_payment(&signer, &request)
            .await
            .unwrap_err();
        assert!(
            matches!(&error, ChainError::Rejected(detail) if detail.contains("op_underfunded"))
        );
    }
}
