//! Bitcoin transaction building and broadcasting for withdrawals.
//!
//! # Coin Selection Strategy
//!
//! This implementation uses **largest-first** coin selection: UTXOs are sorted
//! by value (descending) and selected until the target amount + estimated fee
//! is covered. This strategy:
//! - Minimizes UTXO fragmentation
//! - Is deterministic and easy to test
//! - Works well for typical withdrawal patterns
//!
//! # Change Handling
//!
//! Change is returned to a designated change address provided at sender
//! construction. If the change amount is below the dust threshold (546 sats),
//! it is added to the fee rather than creating an uneconomical output.
//!
//! # Fee Policy
//!
//! Fees are calculated as: `tx_size_bytes * sats_per_byte`. The rate defaults
//! to 2 sat/byte (testnet-appropriate) and can be configured. Production
//! deployments should query mempool.space or a similar API for dynamic rates.
//!
//! # Confirmation Tracking
//!
//! Transactions are tracked until they reach 2 confirmations, at which point
//! the ledger hold is released or the withdrawal is settled.
//!
//! # Safety
//!
//! The local signer refuses mainnet transactions to prevent accidental loss
//! of real funds during development.

use std::fmt;

use engipay_core::{Asset, Money};
use thiserror::Error;

use super::Txid;

/// Minimum output value (dust threshold) in satoshis.
/// Outputs below this are uneconomical and should not be created.
const DUST_THRESHOLD: u64 = 546;

/// Default fee rate in satoshis per byte (testnet-appropriate).
const DEFAULT_FEE_RATE: u64 = 2;

/// Estimated transaction size in bytes for fee calculation.
/// Based on: 1 input (~148 bytes) + 2 outputs (~68 bytes) + overhead (~10 bytes).
/// This is a conservative estimate; actual size varies by input/output types.
const ESTIMATED_TX_SIZE: u64 = 226;

/// Error type for Bitcoin transaction operations.
#[derive(Debug, Error)]
pub enum BitcoinSenderError {
    #[error("mainnet operations are not supported by the local test signer")]
    MainnetRefused,

    #[error(
        "insufficient funds: need {needed} sats (including {fee} sats fee), have {available} sats"
    )]
    InsufficientFunds {
        needed: u64,
        fee: u64,
        available: u64,
    },

    #[error("invalid destination address: {0}")]
    InvalidAddress(String),

    #[error("transaction building failed: {0}")]
    BuildFailed(String),

    #[error("broadcast failed: {0}")]
    BroadcastFailed(String),

    #[error("RPC error: {0}")]
    RpcError(String),

    #[error("no UTXOs available for coin selection")]
    NoUtxos,
}

/// A Bitcoin UTXO available for spending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Utxo {
    /// Transaction ID containing this output.
    pub txid: Txid,
    /// Output index (vout).
    pub vout: u32,
    /// Value in satoshis.
    pub value_sats: u64,
    /// Confirmation count.
    pub confirmations: u32,
}

/// A Bitcoin withdrawal request from the ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WithdrawalRequest {
    /// Destination address (P2PKH, P2WPKH, P2SH, or bech32).
    pub destination: String,
    /// Amount to send in satoshis (excluding fee).
    pub amount_sats: u64,
    /// Optional memo for record-keeping (not included in transaction).
    pub memo: Option<String>,
}

impl WithdrawalRequest {
    /// Creates a new withdrawal request.
    pub fn new(destination: String, amount: Money) -> Result<Self, BitcoinSenderError> {
        if amount.asset != Asset::Btc {
            return Err(BitcoinSenderError::BuildFailed(
                "withdrawal asset must be BTC".to_owned(),
            ));
        }

        // Money stores BTC in satoshis (minor units).
        let amount_sats = u64::try_from(amount.minor)
            .map_err(|_| BitcoinSenderError::BuildFailed("amount out of range".to_owned()))?;

        if amount_sats == 0 {
            return Err(BitcoinSenderError::BuildFailed(
                "amount must be positive".to_owned(),
            ));
        }

        Ok(Self {
            destination,
            amount_sats,
            memo: None,
        })
    }

    /// Attaches a memo to the withdrawal request.
    pub fn with_memo(mut self, memo: String) -> Self {
        self.memo = Some(memo);
        self
    }
}

/// A prepared (signed) Bitcoin transaction ready for broadcast.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedTransaction {
    /// The transaction hash (TXID).
    pub txid: Txid,
    /// Raw transaction bytes (serialized, signed). Placeholder for now.
    pub raw_tx: Vec<u8>,
    /// Fee paid in satoshis.
    pub fee_sats: u64,
    /// Inputs used.
    pub inputs: Vec<Utxo>,
    /// Change amount in satoshis (0 if no change output).
    pub change_sats: u64,
}

/// Bitcoin network type for signer validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BitcoinNetwork {
    Mainnet,
    Testnet,
    Regtest,
}

/// Result of coin selection.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct CoinSelection {
    /// UTXOs selected to cover amount + fee.
    selected: Vec<Utxo>,
    /// Total value of selected UTXOs.
    total_value: u64,
    /// Estimated fee in satoshis.
    fee: u64,
    /// Change to return (0 if below dust threshold).
    change: u64,
}

/// Selects UTXOs using largest-first strategy.
///
/// Returns [`CoinSelection`] with the selected UTXOs and calculated fee/change,
/// or an error if funds are insufficient.
fn select_coins(
    mut available: Vec<Utxo>,
    target: u64,
    fee_rate: u64,
) -> Result<CoinSelection, BitcoinSenderError> {
    if available.is_empty() {
        return Err(BitcoinSenderError::NoUtxos);
    }

    // Sort UTXOs largest-first for optimal selection.
    available.sort_by_key(|a| std::cmp::Reverse(a.value_sats));

    let estimated_fee = ESTIMATED_TX_SIZE
        .checked_mul(fee_rate)
        .ok_or_else(|| BitcoinSenderError::BuildFailed("fee overflow".to_owned()))?;
    let total_needed = target
        .checked_add(estimated_fee)
        .ok_or_else(|| BitcoinSenderError::BuildFailed("amount overflow".to_owned()))?;

    let mut selected = Vec::new();
    let mut accumulated = 0u64;

    for utxo in available {
        selected.push(utxo.clone());
        accumulated = accumulated.checked_add(utxo.value_sats).ok_or_else(|| {
            BitcoinSenderError::BuildFailed("accumulated value overflow".to_owned())
        })?;

        if accumulated >= total_needed {
            // Calculate actual change after fee.
            let change_before_dust = accumulated
                .saturating_sub(target)
                .saturating_sub(estimated_fee);
            let change = if change_before_dust < DUST_THRESHOLD {
                0 // Add to fee instead of creating dust output
            } else {
                change_before_dust
            };

            let actual_fee = accumulated.saturating_sub(target).saturating_sub(change);

            return Ok(CoinSelection {
                selected,
                total_value: accumulated,
                fee: actual_fee,
                change,
            });
        }
    }

    // Not enough funds
    let total_available: u64 = selected.iter().map(|u| u.value_sats).sum();
    Err(BitcoinSenderError::InsufficientFunds {
        needed: total_needed,
        fee: estimated_fee,
        available: total_available,
    })
}

/// Trait for Bitcoin transaction signing.
///
/// Implementations must refuse mainnet operations when using test keys.
pub trait BitcoinSigner: Send + Sync {
    /// Returns the network this signer is configured for.
    fn network(&self) -> BitcoinNetwork;

    /// Returns available UTXOs for spending.
    fn list_utxos(
        &self,
    ) -> impl std::future::Future<Output = Result<Vec<Utxo>, BitcoinSenderError>> + Send;

    /// Signs a withdrawal transaction using the provided coin selection.
    ///
    /// # Errors
    ///
    /// Returns [`BitcoinSenderError::MainnetRefused`] if the signer is a test
    /// signer and `network()` returns [`BitcoinNetwork::Mainnet`].
    fn sign_withdrawal(
        &self,
        _request: &WithdrawalRequest,
        selection: &CoinSelection,
        change_address: &str,
    ) -> impl std::future::Future<Output = Result<PreparedTransaction, BitcoinSenderError>> + Send;
}

/// Local test signer that refuses mainnet.
///
/// This is a placeholder implementation for development. Production signers
/// should use BDK or a similar library with proper key management.
#[derive(Debug)]
pub struct LocalTestSigner {
    network: BitcoinNetwork,
    utxos: Vec<Utxo>,
}

impl LocalTestSigner {
    /// Creates a new test signer for the given network.
    ///
    /// # Safety
    ///
    /// Only accepts testnet or regtest. Mainnet is rejected at construction
    /// to prevent accidental misconfiguration.
    pub fn new(network: BitcoinNetwork) -> Result<Self, BitcoinSenderError> {
        if network == BitcoinNetwork::Mainnet {
            return Err(BitcoinSenderError::MainnetRefused);
        }
        Ok(Self {
            network,
            utxos: Vec::new(),
        })
    }

    /// Adds test UTXOs for coin selection testing.
    #[cfg(test)]
    pub fn with_utxos(mut self, utxos: Vec<Utxo>) -> Self {
        self.utxos = utxos;
        self
    }
}

impl BitcoinSigner for LocalTestSigner {
    fn network(&self) -> BitcoinNetwork {
        self.network
    }

    async fn list_utxos(&self) -> Result<Vec<Utxo>, BitcoinSenderError> {
        Ok(self.utxos.clone())
    }

    async fn sign_withdrawal(
        &self,
        _request: &WithdrawalRequest,
        selection: &CoinSelection,
        _change_address: &str,
    ) -> Result<PreparedTransaction, BitcoinSenderError> {
        if self.network == BitcoinNetwork::Mainnet {
            return Err(BitcoinSenderError::MainnetRefused);
        }

        // Placeholder: Real implementation would build and sign the transaction.
        // For now, return a mock prepared transaction for testing.
        Ok(PreparedTransaction {
            txid: Txid::from_bytes([0xaa; 32]),
            raw_tx: vec![0x01, 0x00, 0x00, 0x00], // Mock raw tx
            fee_sats: selection.fee,
            inputs: selection.selected.clone(),
            change_sats: selection.change,
        })
    }
}

/// Configuration for the Bitcoin withdrawal sender.
#[derive(Debug, Clone)]
pub struct SenderConfig {
    /// Change address for returning excess funds.
    pub change_address: String,
    /// Fee rate in satoshis per byte.
    pub fee_rate_sats_per_byte: u64,
}

impl SenderConfig {
    /// Creates default configuration with a change address.
    pub fn new(change_address: String) -> Self {
        Self {
            change_address,
            fee_rate_sats_per_byte: DEFAULT_FEE_RATE,
        }
    }

    /// Sets a custom fee rate.
    pub fn with_fee_rate(mut self, sats_per_byte: u64) -> Self {
        self.fee_rate_sats_per_byte = sats_per_byte;
        self
    }
}

/// Bitcoin withdrawal sender for broadcasting and tracking transactions.
pub struct BitcoinWithdrawalSender<S: BitcoinSigner> {
    signer: S,
    config: SenderConfig,
}

impl<S: BitcoinSigner> BitcoinWithdrawalSender<S> {
    /// Creates a new Bitcoin withdrawal sender with the given signer and config.
    pub fn new(signer: S, config: SenderConfig) -> Self {
        Self { signer, config }
    }

    /// Builds, signs, and broadcasts a withdrawal transaction.
    ///
    /// # Process
    ///
    /// 1. Lists available UTXOs from the signer
    /// 2. Selects coins using largest-first strategy
    /// 3. Calculates fee and change
    /// 4. Signs the transaction
    /// 5. Broadcasts to the network (placeholder)
    ///
    /// # Returns
    ///
    /// The prepared transaction with TXID, fee, and change details.
    ///
    /// # Errors
    ///
    /// - [`BitcoinSenderError::MainnetRefused`] if the signer refuses mainnet
    /// - [`BitcoinSenderError::InsufficientFunds`] if UTXOs cannot cover amount + fee
    /// - [`BitcoinSenderError::BroadcastFailed`] if the network rejects the transaction
    pub async fn send_withdrawal(
        &self,
        request: &WithdrawalRequest,
    ) -> Result<PreparedTransaction, BitcoinSenderError> {
        // 1. List available UTXOs
        let utxos = self.signer.list_utxos().await?;

        // 2. Select coins
        let selection = select_coins(
            utxos,
            request.amount_sats,
            self.config.fee_rate_sats_per_byte,
        )?;

        // 3. Sign the transaction
        let prepared = self
            .signer
            .sign_withdrawal(request, &selection, &self.config.change_address)
            .await?;

        // 4. Broadcast (placeholder - needs RPC client or esplora)
        // Real implementation would POST raw_tx to bitcoind or esplora
        tracing::info!(
            txid = %hex::encode(prepared.txid.as_bytes()),
            amount = request.amount_sats,
            fee = prepared.fee_sats,
            change = prepared.change_sats,
            "bitcoin withdrawal prepared (broadcast not implemented)"
        );

        Ok(prepared)
    }

    /// Checks if a transaction has reached 2 confirmations.
    ///
    /// # Returns
    ///
    /// `true` if the transaction has 2+ confirmations, `false` otherwise.
    pub async fn is_confirmed(&self, _txid: &Txid) -> Result<bool, BitcoinSenderError> {
        // Placeholder: Real implementation would query block height and
        // transaction confirmation count via RPC or block explorer API
        Err(BitcoinSenderError::RpcError(
            "confirmation tracking not implemented".to_owned(),
        ))
    }
}

impl<S: BitcoinSigner> fmt::Debug for BitcoinWithdrawalSender<S> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BitcoinWithdrawalSender")
            .field("network", &self.signer.network())
            .field("change_address", &self.config.change_address)
            .field("fee_rate", &self.config.fee_rate_sats_per_byte)
            .finish()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use engipay_core::{Asset, Money};

    fn test_utxo(value_sats: u64, confirmations: u32) -> Utxo {
        Utxo {
            txid: Txid::from_bytes([0; 32]),
            vout: 0,
            value_sats,
            confirmations,
        }
    }

    // ── LocalTestSigner ──────────────────────────────────────────────────────

    #[test]
    fn local_signer_refuses_mainnet() {
        let result = LocalTestSigner::new(BitcoinNetwork::Mainnet);
        assert!(matches!(result, Err(BitcoinSenderError::MainnetRefused)));
    }

    #[test]
    fn local_signer_accepts_testnet() {
        let signer = LocalTestSigner::new(BitcoinNetwork::Testnet).unwrap();
        assert_eq!(signer.network(), BitcoinNetwork::Testnet);
    }

    #[tokio::test]
    async fn mainnet_signer_refuses_signing() {
        let signer = LocalTestSigner {
            network: BitcoinNetwork::Mainnet,
            utxos: vec![],
        };
        let request = WithdrawalRequest {
            destination: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".to_owned(),
            amount_sats: 10_000,
            memo: None,
        };
        let selection = CoinSelection {
            selected: vec![],
            total_value: 0,
            fee: 0,
            change: 0,
        };
        let result = signer.sign_withdrawal(&request, &selection, "change").await;
        assert!(matches!(result, Err(BitcoinSenderError::MainnetRefused)));
    }

    // ── WithdrawalRequest ────────────────────────────────────────────────────

    #[test]
    fn withdrawal_request_validates_asset() {
        let xlm = Money::from_minor(Asset::Xlm, 1000);
        let result = WithdrawalRequest::new("addr".to_owned(), xlm);
        assert!(result.is_err());
    }

    #[test]
    fn withdrawal_request_converts_sats() {
        let btc = Money::from_minor(Asset::Btc, 100_000);
        let request = WithdrawalRequest::new("tb1q...".to_owned(), btc).unwrap();
        assert_eq!(request.amount_sats, 100_000);
    }

    #[test]
    fn withdrawal_request_rejects_zero() {
        let btc = Money::from_minor(Asset::Btc, 0);
        let result = WithdrawalRequest::new("addr".to_owned(), btc);
        assert!(result.is_err());
    }

    #[test]
    fn withdrawal_request_with_memo() {
        let btc = Money::from_minor(Asset::Btc, 50_000);
        let request = WithdrawalRequest::new("addr".to_owned(), btc)
            .unwrap()
            .with_memo("test withdrawal".to_owned());
        assert_eq!(request.memo, Some("test withdrawal".to_owned()));
    }

    // ── Coin Selection ───────────────────────────────────────────────────────

    #[test]
    fn coin_selection_picks_largest_first() {
        let utxos = vec![
            test_utxo(1_000, 6),
            test_utxo(5_000, 6),
            test_utxo(3_000, 6),
        ];
        let selection = select_coins(utxos, 6_000, 2).unwrap();
        // Should pick 5_000 + 3_000 = 8_000, leaving 8_000 - 6_000 - fee as change
        assert_eq!(selection.selected.len(), 2);
        assert_eq!(selection.selected[0].value_sats, 5_000);
        assert_eq!(selection.selected[1].value_sats, 3_000);
    }

    #[test]
    fn coin_selection_handles_exact_match() {
        let utxos = vec![test_utxo(10_000, 6)];
        let selection = select_coins(utxos, 9_548, 2).unwrap();
        // 10_000 - 9_548 - (226 * 2) = -0 (no change)
        assert_eq!(selection.selected.len(), 1);
        assert!(selection.change < DUST_THRESHOLD);
    }

    #[test]
    fn coin_selection_fails_on_insufficient_funds() {
        let utxos = vec![test_utxo(1_000, 6)];
        let result = select_coins(utxos, 10_000, 2);
        assert!(matches!(
            result,
            Err(BitcoinSenderError::InsufficientFunds { .. })
        ));
    }

    #[test]
    fn coin_selection_avoids_dust_change() {
        // 1000 - 100 - (226 * 2) = 448 sats change (below 546 dust threshold)
        let utxos = vec![test_utxo(1_000, 6)];
        let selection = select_coins(utxos, 100, 2).unwrap();
        assert_eq!(
            selection.change, 0,
            "change below dust should be added to fee"
        );
        assert!(selection.fee > ESTIMATED_TX_SIZE * 2);
    }

    #[test]
    fn coin_selection_fails_on_empty_utxos() {
        let result = select_coins(vec![], 1_000, 2);
        assert!(matches!(result, Err(BitcoinSenderError::NoUtxos)));
    }

    // ── End-to-end ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn sender_builds_withdrawal_with_coin_selection() {
        let utxos = vec![
            test_utxo(50_000, 6),
            test_utxo(30_000, 6),
            test_utxo(20_000, 6),
        ];
        let signer = LocalTestSigner::new(BitcoinNetwork::Testnet)
            .unwrap()
            .with_utxos(utxos);

        let config = SenderConfig::new("tb1qchange...".to_owned());
        let sender = BitcoinWithdrawalSender::new(signer, config);

        let request = WithdrawalRequest::new(
            "tb1qdest...".to_owned(),
            Money::from_minor(Asset::Btc, 60_000),
        )
        .unwrap();

        let prepared = sender.send_withdrawal(&request).await.unwrap();

        // Should select 50_000 + 30_000 = 80_000
        assert_eq!(prepared.inputs.len(), 2);
        assert!(prepared.fee_sats > 0);
        // 80_000 in, 60_000 out, so the change is 20_000 less the fee.
        assert!(prepared.change_sats < 20_000);
    }

    #[tokio::test]
    async fn sender_fails_on_insufficient_funds() {
        let utxos = vec![test_utxo(1_000, 6)];
        let signer = LocalTestSigner::new(BitcoinNetwork::Testnet)
            .unwrap()
            .with_utxos(utxos);

        let config = SenderConfig::new("tb1qchange...".to_owned());
        let sender = BitcoinWithdrawalSender::new(signer, config);

        let request = WithdrawalRequest::new(
            "tb1qdest...".to_owned(),
            Money::from_minor(Asset::Btc, 100_000),
        )
        .unwrap();

        let result = sender.send_withdrawal(&request).await;
        assert!(matches!(
            result,
            Err(BitcoinSenderError::InsufficientFunds { .. })
        ));
    }
}
