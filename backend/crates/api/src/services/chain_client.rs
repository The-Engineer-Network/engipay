use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::Config;

/// Errors returned by [`ChainClient`].
#[derive(Debug, Error)]
pub enum ChainClientError {
    /// The chain service base URL is not configured.
    #[error("chain service is not configured")]
    NotConfigured,
    /// The chain service could not be reached, timed out, or returned an error status.
    #[error("chain service unavailable: {0}")]
    Unavailable(String),
}

/// Request body for `POST /internal/estimate-fee`.
#[derive(Debug, Serialize)]
pub struct EstimateFeeRequest {
    pub chain: String,
    pub asset: String,
    pub amount: String,
}

/// Response body for `POST /internal/estimate-fee`.
#[derive(Debug, Deserialize)]
pub struct EstimateFeeResponse {
    /// Estimated network fee, as a decimal string.
    pub fee: String,
}

/// Request body for `POST /internal/create-wallet`.
#[derive(Debug, Serialize)]
pub struct CreateWalletRequest {
    pub user_id: String,
    pub chain: String,
}

/// Response body for `POST /internal/create-wallet`.
#[derive(Debug, Deserialize)]
pub struct CreateWalletResponse {
    pub address: String,
}

/// A small typed HTTP client for the chain service.
#[derive(Debug, Clone)]
pub struct ChainClient {
    base_url: Option<String>,
    http: Client,
}

impl ChainClient {
    /// Build a new client from the application configuration.
    ///
    /// When `Config::chain_service_url` is unset, the client is created in a
    /// "not configured" state and its methods return
    /// [`ChainClientError::NotConfigured`].
    pub fn new(config: &Config) -> Self {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .build()
            .expect("failed to build reqwest client");

        let base_url = config
            .chain_service_url
            .as_ref()
            .map(|url| url.trim_end_matches('/').to_string())
            .filter(|url| !url.is_empty());

        Self { base_url, http }
    }

    /// Returns `true` when a base URL is configured.
    pub fn is_configured(&self) -> bool {
        self.base_url.is_some()
    }

    fn endpoint(&self, path: &str) -> Result<String, ChainClientError> {
        match &self.base_url {
            Some(base) => Ok(format!("{base}{path}")),
            None => Err(ChainClientError::NotConfigured),
        }
    }

    /// Estimate the network fee for a withdrawal.
    pub async fn estimate_fee(
        &self,
        chain: &str,
        asset: &str,
        amount: &str,
    ) -> Result<EstimateFeeResponse, ChainClientError> {
        let url = self.endpoint("/internal/estimate-fee")?;
        let body = EstimateFeeRequest {
            chain: chain.to_string(),
            asset: asset.to_string(),
            amount: amount.to_string(),
        };

        let response = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|err| ChainClientError::Unavailable(err.to_string()))?;

        if !response.status().is_success() {
            return Err(ChainClientError::Unavailable(format!(
                "estimate-fee returned status {}",
                response.status()
            )));
        }

        response
            .json::<EstimateFeeResponse>()
            .await
            .map_err(|err| ChainClientError::Unavailable(err.to_string()))
    }

    /// Create a wallet for a user on the given chain.
    pub async fn create_wallet(
        &self,
        user_id: &str,
        chain: &str,
    ) -> Result<CreateWalletResponse, ChainClientError> {
        let url = self.endpoint("/internal/create-wallet")?;
        let body = CreateWalletRequest {
            user_id: user_id.to_string(),
            chain: chain.to_string(),
        };

        let response = self
            .http
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|err| ChainClientError::Unavailable(err.to_string()))?;

        if !response.status().is_success() {
            return Err(ChainClientError::Unavailable(format!(
                "create-wallet returned status {}",
                response.status()
            )));
        }

        response
            .json::<CreateWalletResponse>()
            .await
            .map_err(|err| ChainClientError::Unavailable(err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn client_for(base_url: Option<String>) -> ChainClient {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .build()
            .expect("failed to build reqwest client");

        ChainClient {
            base_url: base_url.map(|url| url.trim_end_matches('/').to_string()),
            http,
        }
    }

    #[tokio::test]
    async fn estimate_fee_success() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/internal/estimate-fee"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "fee": "0.00042"
            })))
            .mount(&server)
            .await;

        let client = client_for(Some(server.uri()));
        let result = client.estimate_fee("ethereum", "ETH", "1.5").await.unwrap();

        assert_eq!(result.fee, "0.00042");
    }

    #[tokio::test]
    async fn create_wallet_success() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/internal/create-wallet"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "address": "0xabc123"
            })))
            .mount(&server)
            .await;

        let client = client_for(Some(server.uri()));
        let result = client.create_wallet("user-1", "ethereum").await.unwrap();

        assert_eq!(result.address, "0xabc123");
    }

    #[tokio::test]
    async fn estimate_fee_not_configured() {
        let client = client_for(None);
        let err = client
            .estimate_fee("ethereum", "ETH", "1.0")
            .await
            .unwrap_err();

        assert!(matches!(err, ChainClientError::NotConfigured));
    }

    #[tokio::test]
    async fn create_wallet_not_configured() {
        let client = client_for(None);
        let err = client.create_wallet("user-1", "ethereum").await.unwrap_err();

        assert!(matches!(err, ChainClientError::NotConfigured));
    }

    #[tokio::test]
    async fn estimate_fee_outage_returns_unavailable() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/internal/estimate-fee"))
            .respond_with(ResponseTemplate::new(500))
            .mount(&server)
            .await;

        let client = client_for(Some(server.uri()));
        let err = client
            .estimate_fee("ethereum", "ETH", "1.0")
            .await
            .unwrap_err();

        assert!(matches!(err, ChainClientError::Unavailable(_)));
    }

    #[tokio::test]
    async fn create_wallet_outage_returns_unavailable() {
        let server = MockServer::start().await;

        Mock::given(method("POST"))
            .and(path("/internal/create-wallet"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let client = client_for(Some(server.uri()));
        let err = client.create_wallet("user-1", "ethereum").await.unwrap_err();

        assert!(matches!(err, ChainClientError::Unavailable(_)));
    }

    #[tokio::test]
    async fn connection_refused_returns_unavailable() {
        // Point at a port that is not listening.
        let client = client_for(Some("http://127.0.0.1:1".to_string()));
        let err = client
            .estimate_fee("ethereum", "ETH", "1.0")
            .await
            .unwrap_err();

        assert!(matches!(err, ChainClientError::Unavailable(_)));
    }
}