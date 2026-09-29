//! HTTP access to Base with an explicit network and a bounded RPC health check.

use std::time::Duration;

use alloy::providers::{Provider, ProviderBuilder, RootProvider};
use reqwest::Url;

use crate::ChainError;

const RPC_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseNetwork {
    Sepolia,
    Mainnet,
}

impl BaseNetwork {
    /// Development uses testnet; production must explicitly select mainnet.
    pub fn parse(value: &str) -> Result<Self, ChainError> {
        match value {
            "testnet" => Ok(Self::Sepolia),
            "mainnet" => Ok(Self::Mainnet),
            _ => Err(ChainError::Config(
                "BASE_NETWORK must be testnet or mainnet".to_owned(),
            )),
        }
    }

    pub const fn chain_id(self) -> u64 {
        match self {
            Self::Sepolia => 84_532,
            Self::Mainnet => 8_453,
        }
    }

    pub const fn default_rpc_url(self) -> &'static str {
        match self {
            Self::Sepolia => "https://sepolia.base.org",
            Self::Mainnet => "https://mainnet.base.org",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProviderHealth {
    pub chain_id: u64,
    pub block_number: u64,
}

/// Clones share the HTTP connection pool. Construction validates configuration
/// without making a request; call `health_check` to verify the remote network.
#[derive(Clone)]
pub struct AlloyProvider {
    inner: RootProvider,
    network: BaseNetwork,
    timeout: Duration,
}

impl AlloyProvider {
    /// An absent or blank override uses the network's public RPC endpoint.
    pub fn new(network: BaseNetwork, rpc_url: Option<&str>) -> Result<Self, ChainError> {
        let endpoint = rpc_url
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| network.default_rpc_url());
        let url = Url::parse(endpoint)
            .map_err(|_| ChainError::Config("BASE_RPC_URL must be an HTTP(S) URL".to_owned()))?;
        if !matches!(url.scheme(), "http" | "https")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
        {
            return Err(ChainError::Config(
                "BASE_RPC_URL must be an HTTP(S) URL without user info or a fragment".to_owned(),
            ));
        }
        let client = reqwest::Client::builder()
            .timeout(RPC_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| ChainError::Config("could not build Base HTTP client".to_owned()))?;
        let inner = ProviderBuilder::default().connect_reqwest(client, url);
        Ok(Self {
            inner,
            network,
            timeout: RPC_TIMEOUT,
        })
    }

    pub fn network(&self) -> BaseNetwork {
        self.network
    }

    /// Typed Alloy access for subsequent EVM read and transaction operations.
    pub fn provider(&self) -> &RootProvider {
        &self.inner
    }

    /// Queries eth_chainId and eth_blockNumber. A responsive endpoint on the
    /// wrong chain is a configuration failure, not a healthy Base provider.
    pub async fn health_check(&self) -> Result<ProviderHealth, ChainError> {
        tokio::time::timeout(self.timeout, async {
            // Do not include transport errors: hosted RPC URLs can contain keys.
            let chain_id = self.inner.get_chain_id().await.map_err(|_| {
                ChainError::Unavailable("Base eth_chainId request failed".to_owned())
            })?;
            if chain_id != self.network.chain_id() {
                return Err(ChainError::Config(format!(
                    "Base RPC chain ID mismatch: expected {}, received {chain_id}",
                    self.network.chain_id()
                )));
            }
            let block_number = self.inner.get_block_number().await.map_err(|_| {
                ChainError::Unavailable("Base eth_blockNumber request failed".to_owned())
            })?;
            Ok(ProviderHealth {
                chain_id,
                block_number,
            })
        })
        .await
        .map_err(|_| ChainError::Unavailable("Base RPC health check timed out".to_owned()))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use wiremock::matchers::{body_partial_json, method};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    async fn rpc(server: &MockServer, name: &str, response: Value) {
        Mock::given(method("POST"))
            .and(body_partial_json(json!({"jsonrpc": "2.0", "method": name})))
            .respond_with(move |request: &Request| {
                let body: Value = request.body_json().expect("JSON-RPC request");
                let mut reply = response.clone();
                reply["jsonrpc"] = json!("2.0");
                reply["id"] = body["id"].clone();
                ResponseTemplate::new(200).set_body_json(reply)
            })
            .expect(1)
            .mount(server)
            .await;
    }

    #[test]
    fn initializes_both_networks_without_rpc() {
        for (network, id, url) in [
            (BaseNetwork::Sepolia, 84_532, "https://sepolia.base.org"),
            (BaseNetwork::Mainnet, 8_453, "https://mainnet.base.org"),
        ] {
            assert_eq!(network.chain_id(), id);
            assert_eq!(network.default_rpc_url(), url);
            for endpoint in [None, Some(" "), Some("http://localhost:8545")] {
                let provider = AlloyProvider::new(network, endpoint).expect("valid config");
                assert_eq!(provider.network(), network);
                let _: &RootProvider = provider.provider();
            }
        }
        assert_eq!(
            BaseNetwork::parse("testnet").expect("testnet"),
            BaseNetwork::Sepolia
        );
        assert_eq!(
            BaseNetwork::parse("mainnet").expect("mainnet"),
            BaseNetwork::Mainnet
        );
        assert!(BaseNetwork::parse("production").is_err());
        assert!(BaseNetwork::parse("").is_err());
    }

    #[test]
    fn rejects_invalid_endpoints_without_echoing_secrets() {
        for url in [
            "not a url",
            "ws://localhost:8545",
            "file:///tmp/rpc",
            "https://user:secret@example.com",
            "https://example.com/#secret",
        ] {
            let error = AlloyProvider::new(BaseNetwork::Sepolia, Some(url))
                .err()
                .expect("invalid endpoint");
            assert!(matches!(error, ChainError::Config(_)));
            assert!(!error.to_string().contains("secret"));
        }
    }

    #[tokio::test]
    async fn pings_both_networks_and_decodes_hex_quantities() {
        for network in [BaseNetwork::Sepolia, BaseNetwork::Mainnet] {
            let server = MockServer::start().await;
            rpc(
                &server,
                "eth_chainId",
                json!({"result": format!("0x{:x}", network.chain_id())}),
            )
            .await;
            rpc(
                &server,
                "eth_blockNumber",
                json!({"result": "0x20000000000001"}),
            )
            .await;
            let provider = AlloyProvider::new(network, Some(&server.uri())).expect("provider");
            assert_eq!(
                provider.health_check().await.expect("healthy"),
                ProviderHealth {
                    chain_id: network.chain_id(),
                    block_number: 9_007_199_254_740_993,
                }
            );
        }
    }

    #[tokio::test]
    async fn rejects_wrong_chain_before_reading_height() {
        let server = MockServer::start().await;
        rpc(&server, "eth_chainId", json!({"result": "0x1"})).await;
        let provider =
            AlloyProvider::new(BaseNetwork::Sepolia, Some(&server.uri())).expect("provider");
        assert!(matches!(
            provider.health_check().await,
            Err(ChainError::Config(_))
        ));
        assert_eq!(server.received_requests().await.expect("requests").len(), 1);
    }

    #[tokio::test]
    async fn reports_rpc_errors_and_malformed_results_for_each_method() {
        for name in ["eth_chainId", "eth_blockNumber"] {
            for response in [
                json!({"error": {"code": -32603, "message": "secret"}}),
                json!({"result": "invalid"}),
                json!({"result": null}),
                json!({"result": "0x10000000000000000"}),
            ] {
                let server = MockServer::start().await;
                if name == "eth_blockNumber" {
                    rpc(&server, "eth_chainId", json!({"result": "0x14a34"})).await;
                }
                rpc(&server, name, response).await;
                let provider = AlloyProvider::new(BaseNetwork::Sepolia, Some(&server.uri()))
                    .expect("provider");
                let error = provider.health_check().await.expect_err("RPC failed");
                assert!(matches!(error, ChainError::Unavailable(_)));
                assert!(error.to_string().contains(name));
                assert!(!error.to_string().contains("secret"));
            }
        }
    }

    #[tokio::test]
    async fn reports_http_failure() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(503))
            .expect(1)
            .mount(&server)
            .await;
        let provider =
            AlloyProvider::new(BaseNetwork::Sepolia, Some(&server.uri())).expect("provider");
        assert!(matches!(
            provider.health_check().await,
            Err(ChainError::Unavailable(_))
        ));
    }

    #[tokio::test]
    async fn bounds_health_check_duration() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(5)))
            .mount(&server)
            .await;
        let mut provider =
            AlloyProvider::new(BaseNetwork::Sepolia, Some(&server.uri())).expect("provider");
        provider.timeout = Duration::from_millis(50);
        let error = provider.health_check().await.expect_err("timeout");
        assert!(matches!(error, ChainError::Unavailable(_)));
        assert!(error.to_string().contains("timed out"));
    }
}
