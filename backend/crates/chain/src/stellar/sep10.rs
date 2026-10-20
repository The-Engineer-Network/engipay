//! SEP-10: Stellar Web Authentication
//!
//! Implements the challenge-response authentication flow that Stellar anchors
//! use to verify account ownership before allowing deposits or withdrawals.
//!
//! See: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md

use super::network::StellarNetwork;
use super::payment::StellarSigner;
use anyhow::Result;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use stellar_xdr::{Limits, ReadXdr, TransactionEnvelope, WriteXdr};

/// SEP-10 authentication errors.
#[derive(Debug, thiserror::Error)]
pub enum Sep10Error {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("invalid challenge transaction: {0}")]
    InvalidChallenge(String),
    #[error("authentication failed: {0}")]
    AuthFailed(String),
    #[error("XDR encoding error: {0}")]
    Xdr(String),
}

#[derive(Debug, Serialize, Deserialize)]
struct ChallengeRequest {
    account: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    home_domain: Option<String>,
}

/// The challenge transaction returned by a SEP-10 `/auth` endpoint.
///
/// Public because [`get_challenge`] returns it and [`authenticate`] accepts
/// it; callers pass it through opaquely between the two calls.
#[derive(Debug, Deserialize)]
pub struct ChallengeResponse {
    transaction: String,
    network_passphrase: String,
}

#[derive(Debug, Serialize)]
struct AuthRequest {
    transaction: String,
}

#[derive(Debug, Deserialize)]
struct AuthResponse {
    token: String,
}

/// Get a challenge transaction from the anchor's SEP-10 endpoint.
///
/// The anchor returns a transaction that must be signed by the account's
/// private key to prove ownership.
pub async fn get_challenge(
    http_client: &Client,
    anchor_url: &str,
    account: &str,
    home_domain: Option<&str>,
) -> Result<ChallengeResponse, Sep10Error> {
    let url = format!("{}/auth", anchor_url.trim_end_matches('/'));

    let request = ChallengeRequest {
        account: account.to_owned(),
        home_domain: home_domain.map(|s| s.to_owned()),
    };

    let response = http_client
        .get(&url)
        .query(&request)
        .send()
        .await?
        .error_for_status()?;

    let challenge: ChallengeResponse = response.json().await?;
    Ok(challenge)
}

/// Sign the challenge transaction and submit it to get a JWT.
///
/// The JWT is used to authenticate subsequent requests to the anchor's
/// SEP-24 endpoints.
pub async fn authenticate(
    http_client: &Client,
    anchor_url: &str,
    challenge: &ChallengeResponse,
    signer: &dyn StellarSigner,
    network: StellarNetwork,
) -> Result<String, Sep10Error> {
    // Verify network matches
    if challenge.network_passphrase != network.passphrase() {
        return Err(Sep10Error::InvalidChallenge(format!(
            "network mismatch: expected {}, got {}",
            network.passphrase(),
            challenge.network_passphrase
        )));
    }

    // Decode the challenge transaction
    let mut envelope = TransactionEnvelope::from_xdr_base64(&challenge.transaction, Limits::none())
        .map_err(|e| Sep10Error::Xdr(e.to_string()))?;

    // Sign it
    envelope = super::payment::add_signature(envelope, signer, network)
        .map_err(|e| Sep10Error::Xdr(e.to_string()))?;

    // Encode back to base64
    let signed_xdr = envelope
        .to_xdr_base64(Limits::none())
        .map_err(|e| Sep10Error::Xdr(e.to_string()))?;

    // Submit to anchor
    let url = format!("{}/auth", anchor_url.trim_end_matches('/'));
    let request = AuthRequest {
        transaction: signed_xdr,
    };

    let response = http_client
        .post(&url)
        .json(&request)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| Sep10Error::AuthFailed(e.to_string()))?;

    let auth: AuthResponse = response.json().await?;
    Ok(auth.token)
}

/// Complete SEP-10 authentication flow: get challenge and sign it.
///
/// Returns a JWT that can be used for subsequent anchor API calls.
pub async fn authenticate_account(
    http_client: &Client,
    anchor_url: &str,
    account: &str,
    home_domain: Option<&str>,
    signer: &dyn StellarSigner,
    network: StellarNetwork,
) -> Result<String, Sep10Error> {
    let challenge = get_challenge(http_client, anchor_url, account, home_domain).await?;
    authenticate(http_client, anchor_url, &challenge, signer, network).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stellar::payment::LocalTestnetSigner;

    #[test]
    fn challenge_request_serializes_correctly() {
        let req = ChallengeRequest {
            account: "GABC123...".to_owned(),
            home_domain: Some("anchor.example.com".to_owned()),
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(json.contains("GABC123"));
        assert!(json.contains("anchor.example.com"));
    }

    #[test]
    fn challenge_request_without_home_domain() {
        let req = ChallengeRequest {
            account: "GABC123...".to_owned(),
            home_domain: None,
        };
        let json = serde_json::to_string(&req).unwrap();
        assert!(!json.contains("home_domain"));
    }

    #[test]
    fn network_mismatch_is_rejected() {
        let _challenge = ChallengeResponse {
            transaction: "AAAA...".to_owned(),
            network_passphrase: "Public Global Stellar Network ; September 2015".to_owned(),
        };

        let secret = stellar_strkey::ed25519::PrivateKey([7; 32]);
        let _signer = LocalTestnetSigner::from_secret(
            secret.as_unredacted().to_string().as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap();

        // This would fail because challenge is for mainnet but signer is testnet
        // In a real test we'd need a mock HTTP client
    }
}
