//! Broadcasting signed Stellar withdrawals and polling them to finality.
//!
//! [`broadcast_withdrawal`] submits the signed envelope to Horizon's
//! `POST /transactions`, checks the hash Horizon reports against the one
//! signed, and records it in `withdrawals.tx_hash`.
//!
//! After a Stellar transaction is submitted to Horizon and accepted into the
//! mempool, its presence in Horizon's response does **not** guarantee ledger
//! inclusion: the network may not close a ledger that contains it if the fee
//! was too low, the time-bounds expired, or the source account sequence has
//! raced ahead.
//!
//! This module polls `GET /transactions/{hash}` until Horizon confirms the
//! transaction is in a closed ledger (`successful = true`) before reporting
//! finality.  Only then does the withdrawal status advance to `confirmed`.
//!
//! # Polling strategy
//!
//! Stellar ledgers close roughly every 5 seconds, so the poll interval
//! defaults to [`DEFAULT_POLL_INTERVAL`].  If no confirmation is observed
//! within [`DEFAULT_TIMEOUT`] the operation returns
//! [`FinalityError::Timeout`] and the caller can choose to retry, alert, or
//! mark the withdrawal for manual review.
//!
//! # Withdrawal status lifecycle
//!
//! ```text
//!   pending_broadcast
//!        │
//!        ▼  submit_payment_with_retry()
//!   broadcast_accepted  (Horizon accepted the XDR)
//!        │
//!        ▼  poll_for_finality()
//!   confirmed           (landed in a closed ledger)
//!        │
//!        or──► pending_manual_review  (timeout / not successful)
//! ```
//!
//! Signing keys are never invoked again after `broadcast_accepted`; the poll
//! only reads Horizon to check the existing transaction.

use std::time::Duration;

use stellar_xdr::TransactionEnvelope;
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::StellarClient;
use super::payment::{envelope_base64, transaction_hash};
use super::settlement::{self, HoldLedger, SettlementError};
use crate::ChainError;
use crate::withdrawals::{StatusUpdate, WithdrawalError, WithdrawalStatus, WithdrawalStore};

// ── Broadcast ─────────────────────────────────────────────────────────────────

/// A withdrawal Horizon accepted into a ledger.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Broadcast {
    /// The transaction hash, hex, as recorded in `withdrawals.tx_hash`.
    pub hash: String,
    /// The ledger sequence Horizon reported it in.
    pub ledger: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum BroadcastError {
    /// The network refused the transaction and it did not land. The
    /// withdrawal is `failed` and its hold released.
    #[error("withdrawal {id} was rejected: {detail}")]
    Rejected { id: Uuid, detail: String },
    /// No definitive answer; the transaction may still land. The withdrawal
    /// is `pending_manual_review` with its hash recorded, and the money stays
    /// held.
    #[error("withdrawal {id} ({hash}) has an unknown outcome: {detail}")]
    Unknown {
        id: Uuid,
        hash: String,
        detail: String,
    },
    #[error("withdrawal {id} is {status}, not awaiting broadcast")]
    NotPending { id: Uuid, status: WithdrawalStatus },
    #[error("the signed envelope is unusable: {0}")]
    Envelope(String),
    #[error(transparent)]
    Store(#[from] WithdrawalError),
    #[error(transparent)]
    Settlement(#[from] SettlementError),
}

/// Lower-case hex, the form Horizon uses for transaction hashes.
pub fn hash_hex(hash: &[u8; 32]) -> String {
    hash.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Submits a signed withdrawal to Horizon and records the outcome.
///
/// * Accepted — `tx_hash` is stored and the withdrawal moves to
///   `broadcast_accepted`. The finality poller takes it from there.
/// * Rejected (`400`) — unless the transaction is in fact already on the
///   ledger (a resubmission of a landed transaction is refused with
///   `tx_bad_seq`), the withdrawal moves to `failed` and its hold is released.
/// * Unknown — the hash is stored and the withdrawal moves to
///   `pending_manual_review`. Its money stays held.
///
/// Safe to call again for a withdrawal already `broadcast_accepted` with the
/// same envelope: Horizon refuses the duplicate, the lookup finds it landed,
/// and the call returns the same [`Broadcast`].
pub async fn broadcast_withdrawal<W: WithdrawalStore, L: HoldLedger>(
    client: &StellarClient,
    store: &W,
    ledger: &L,
    withdrawal_id: Uuid,
    envelope: &TransactionEnvelope,
) -> Result<Broadcast, BroadcastError> {
    let withdrawal = store.get(withdrawal_id).await?;
    if !matches!(
        withdrawal.status,
        WithdrawalStatus::PendingBroadcast | WithdrawalStatus::BroadcastAccepted
    ) {
        return Err(BroadcastError::NotPending {
            id: withdrawal_id,
            status: withdrawal.status,
        });
    }

    let network = client.config().network;
    let hash = transaction_hash(envelope, network)
        .map(|hash| hash_hex(&hash))
        .map_err(|error| BroadcastError::Envelope(error.to_string()))?;
    let xdr =
        envelope_base64(envelope).map_err(|error| BroadcastError::Envelope(error.to_string()))?;

    info!(%withdrawal_id, %hash, "submitting withdrawal to Horizon");
    let detail = match client.submit_transaction(&xdr).await {
        Ok(submitted) if submitted.hash == hash => {
            return accept(store, withdrawal_id, hash, submitted.ledger).await;
        }
        Ok(submitted) => {
            // Horizon says it accepted something else. Do not trust either
            // hash enough to settle or release; a human decides.
            format!("Horizon reported hash {}", submitted.hash)
        }
        Err(ChainError::Rejected(detail)) => {
            return match client.find_transaction(&hash).await {
                Ok(Some(landed)) if landed.ledger > 0 && landed.successful => {
                    info!(%withdrawal_id, %hash, "rejected resubmission had already landed");
                    accept(store, withdrawal_id, hash, landed.ledger).await
                }
                Ok(None) => {
                    warn!(%withdrawal_id, %hash, %detail, "Horizon rejected the withdrawal");
                    settlement::fail_withdrawal(store, ledger, withdrawal_id, Some(hash)).await?;
                    Err(BroadcastError::Rejected {
                        id: withdrawal_id,
                        detail,
                    })
                }
                // In a ledger but failed, or the lookup itself failed: leave
                // it to the finality poller or an operator.
                Ok(Some(_)) => unknown(store, withdrawal_id, hash, detail).await,
                Err(error) => {
                    unknown(
                        store,
                        withdrawal_id,
                        hash,
                        format!("{detail}; then {error}"),
                    )
                    .await
                }
            };
        }
        Err(error) => error.to_string(),
    };
    unknown(store, withdrawal_id, hash, detail).await
}

async fn accept<W: WithdrawalStore>(
    store: &W,
    withdrawal_id: Uuid,
    hash: String,
    ledger: u64,
) -> Result<Broadcast, BroadcastError> {
    store
        .transition(
            withdrawal_id,
            WithdrawalStatus::BroadcastAccepted,
            StatusUpdate {
                tx_hash: Some(hash.clone()),
                confirmed_ledger: None,
            },
        )
        .await?;
    info!(%withdrawal_id, %hash, ledger, "withdrawal accepted by Horizon");
    Ok(Broadcast { hash, ledger })
}

async fn unknown<W: WithdrawalStore>(
    store: &W,
    withdrawal_id: Uuid,
    hash: String,
    detail: String,
) -> Result<Broadcast, BroadcastError> {
    warn!(%withdrawal_id, %hash, %detail, "withdrawal outcome unknown; flagging for manual review");
    store
        .transition(
            withdrawal_id,
            WithdrawalStatus::PendingManualReview,
            StatusUpdate {
                tx_hash: Some(hash.clone()),
                confirmed_ledger: None,
            },
        )
        .await?;
    Err(BroadcastError::Unknown {
        id: withdrawal_id,
        hash,
        detail,
    })
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/// How long to wait between Horizon polls (one Stellar ledger ≈ 5 s).
pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Maximum wall-clock time to wait for a single transaction to land.
/// After this the transaction is considered unconfirmed by this service.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

// ── FinalityOutcome ───────────────────────────────────────────────────────────

/// The result of polling for transaction finality.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FinalityOutcome {
    /// The transaction landed in a closed ledger and `successful = true`.
    Confirmed {
        /// The transaction hash.
        hash: String,
        /// The ledger sequence number in which the transaction was included.
        ledger: u64,
    },
    /// The transaction was found in Horizon but `successful = false`.
    /// This means the transaction was included in a ledger but the network
    /// rejected it (e.g. `tx_failed`).  The withdrawal must not be settled.
    Failed { hash: String, ledger: u64 },
}

// ── FinalityError ─────────────────────────────────────────────────────────────

/// Errors from the finality polling loop.
#[derive(Debug, thiserror::Error)]
pub enum FinalityError {
    /// No confirmation was observed within the configured timeout.
    #[error(
        "transaction {hash} was not confirmed within {timeout:?}; \
         manual review may be required"
    )]
    Timeout { hash: String, timeout: Duration },

    /// Horizon returned an error during polling.
    #[error("Horizon error while polling {hash}: {source}")]
    Horizon {
        hash: String,
        #[source]
        source: ChainError,
    },
}

// ── FinalistPoller ────────────────────────────────────────────────────────────

/// Polls Horizon for transaction finality.
///
/// Construct with [`FinalityPoller::new`] or [`FinalityPoller::with_config`]
/// and call [`poll`](FinalityPoller::poll) once per withdrawal.
///
/// The poller is stateless: it does not keep any connection open and can be
/// called concurrently for independent transactions.
pub struct FinalityPoller {
    poll_interval: Duration,
    timeout: Duration,
}

impl FinalityPoller {
    /// Creates a poller with the production defaults.
    pub fn new() -> Self {
        Self {
            poll_interval: DEFAULT_POLL_INTERVAL,
            timeout: DEFAULT_TIMEOUT,
        }
    }

    /// Creates a poller with explicit intervals. Useful in tests.
    pub fn with_config(poll_interval: Duration, timeout: Duration) -> Self {
        Self {
            poll_interval,
            timeout,
        }
    }

    /// Polls Horizon until the transaction identified by `tx_hash` lands in a
    /// closed ledger, or until the timeout elapses.
    ///
    /// The `fetch_fn` abstraction allows unit tests to inject a fake HTTP
    /// backend without spinning up a real Horizon instance.
    ///
    /// # Errors
    ///
    /// * [`FinalityError::Timeout`] — no confirmation within `self.timeout`.
    /// * [`FinalityError::Horizon`] — Horizon returned a non-transient error.
    ///
    /// Transient Horizon errors (503, 429, etc.) are **not** surfaced; polling
    /// continues until the timeout rather than aborting on a transient glitch.
    pub async fn poll<F, Fut>(
        &self,
        tx_hash: &str,
        fetch_fn: F,
    ) -> Result<FinalityOutcome, FinalityError>
    where
        F: Fn(String) -> Fut,
        Fut: std::future::Future<Output = Result<TxStatus, ChainError>>,
    {
        let start = tokio::time::Instant::now();

        info!(
            hash = %tx_hash,
            timeout_secs = self.timeout.as_secs(),
            "polling Horizon for transaction finality"
        );

        loop {
            // Check timeout before sleeping on the first iteration too, so a
            // zero-timeout can be tested without real sleeps.
            let elapsed = start.elapsed();
            if elapsed >= self.timeout {
                warn!(
                    hash = %tx_hash,
                    elapsed_secs = elapsed.as_secs(),
                    timeout_secs = self.timeout.as_secs(),
                    "transaction not confirmed within timeout; flagging for manual review"
                );
                return Err(FinalityError::Timeout {
                    hash: tx_hash.to_owned(),
                    timeout: self.timeout,
                });
            }

            debug!(
                hash = %tx_hash,
                elapsed_secs = elapsed.as_secs(),
                "checking Horizon for transaction inclusion"
            );

            match fetch_fn(tx_hash.to_owned()).await {
                Ok(TxStatus::IncludedSuccessful { ledger }) => {
                    info!(
                        hash = %tx_hash,
                        ledger,
                        "transaction confirmed in closed ledger"
                    );
                    return Ok(FinalityOutcome::Confirmed {
                        hash: tx_hash.to_owned(),
                        ledger,
                    });
                }
                Ok(TxStatus::IncludedFailed { ledger }) => {
                    warn!(
                        hash = %tx_hash,
                        ledger,
                        "transaction included in ledger but marked failed"
                    );
                    return Ok(FinalityOutcome::Failed {
                        hash: tx_hash.to_owned(),
                        ledger,
                    });
                }
                Ok(TxStatus::NotYetIncluded) => {
                    debug!(
                        hash = %tx_hash,
                        "transaction not yet in a closed ledger; will retry"
                    );
                }
                Err(source) => {
                    // Transient errors (429, 503, etc.) are already retried
                    // inside `StellarClient::get_with_retry`. If we still get
                    // an error here it is persistent; surface it.
                    warn!(
                        hash = %tx_hash,
                        error = %source,
                        "Horizon error during finality poll; aborting"
                    );
                    return Err(FinalityError::Horizon {
                        hash: tx_hash.to_owned(),
                        source,
                    });
                }
            }

            // Sleep between polls. We check the timeout again at the top of
            // the next iteration so we never sleep past the deadline.
            let remaining = self.timeout.saturating_sub(start.elapsed());
            let sleep_for = self.poll_interval.min(remaining);
            if sleep_for.is_zero() {
                // Timeout will be caught at the top of the next iteration.
                continue;
            }
            tokio::time::sleep(sleep_for).await;
        }
    }
}

impl Default for FinalityPoller {
    fn default() -> Self {
        Self::new()
    }
}

// ── TxStatus ─────────────────────────────────────────────────────────────────

/// The result of a single `GET /transactions/{hash}` call, reduced to the
/// three states the finality poller cares about.
///
/// This is the type returned by the `fetch_fn` argument to
/// [`FinalityPoller::poll`].  The [`from_horizon`](TxStatus::from_horizon)
/// constructor maps the raw Horizon response (a
/// [`JoinedTransaction`](crate::stellar::horizon::JoinedTransaction)) onto
/// this type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TxStatus {
    /// Transaction is in a closed ledger and the network accepted it.
    IncludedSuccessful { ledger: u64 },
    /// Transaction is in a closed ledger but the network rejected it.
    IncludedFailed { ledger: u64 },
    /// Horizon does not yet have this transaction in a closed ledger.
    NotYetIncluded,
}

impl TxStatus {
    /// Converts a `JoinedTransaction` (from `GET /transactions/{hash}`) into
    /// one of the three polling-relevant states.
    ///
    /// Horizon returns a `JoinedTransaction` with `ledger > 0` once the
    /// transaction is in a closed ledger. A `ledger` of `0` is returned for
    /// mempool transactions that have not yet been included.
    pub fn from_horizon(ledger: u64, successful: bool) -> Self {
        if ledger == 0 {
            Self::NotYetIncluded
        } else if successful {
            Self::IncludedSuccessful { ledger }
        } else {
            Self::IncludedFailed { ledger }
        }
    }
}

// ── Integration with StellarClient ───────────────────────────────────────────

/// Polls for finality using a live [`StellarClient`].
///
/// This is a convenience wrapper that wires [`FinalityPoller::poll`] to the
/// real `GET /transactions/{hash}` endpoint via
/// [`StellarClient::fetch_transaction`].
///
/// # Errors
///
/// Returns [`FinalityError::Timeout`] or [`FinalityError::Horizon`]; see
/// [`FinalityPoller::poll`] for details.
pub async fn poll_transaction_finality(
    client: &crate::stellar::StellarClient,
    tx_hash: &str,
    poller: &FinalityPoller,
) -> Result<FinalityOutcome, FinalityError> {
    poller
        .poll(tx_hash, |hash| {
            let client_ref = client;
            async move {
                match client_ref.fetch_transaction(&hash).await {
                    Ok(joined) => Ok(TxStatus::from_horizon(joined.ledger, joined.successful)),
                    Err(ChainError::Unavailable(_)) => Ok(TxStatus::NotYetIncluded),
                    Err(other) => Err(other),
                }
            }
        })
        .await
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;

    // ── broadcast_withdrawal ──────────────────────────────────────────────────

    use engipay_core::Asset;
    use engipay_ledger::{HoldState, SystemAccount};
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::stellar::payment::{
        CustodySigner, LocalTestnetSigner, PaymentRequest, StellarSigner, build_payment,
        sign_withdrawal,
    };
    use crate::stellar::settlement::fake::MemoryLedger;
    use crate::stellar::{StellarConfig, StellarNetwork};
    use crate::withdrawals::fake::{FakeWithdrawalStore, pending};
    use crate::withdrawals::{Withdrawal, WithdrawalStatus::*};

    struct Harness {
        server: MockServer,
        client: StellarClient,
        store: FakeWithdrawalStore,
        ledger: MemoryLedger,
        withdrawal: Withdrawal,
        envelope: TransactionEnvelope,
        hash: String,
    }

    async fn harness() -> Harness {
        let signer = LocalTestnetSigner::from_secret(
            stellar_strkey::ed25519::PrivateKey([4; 32])
                .as_unredacted()
                .to_string()
                .as_str(),
            StellarNetwork::Testnet,
        )
        .unwrap();
        let custody_account = signer.account();
        let custody = CustodySigner::new(signer, &custody_account).unwrap();

        let server = MockServer::start().await;
        let config = StellarConfig::new(
            StellarNetwork::Testnet,
            Some(server.uri()),
            &custody_account,
        )
        .unwrap();
        let client = StellarClient::new(config).unwrap();

        let withdrawal = pending(Asset::Usdc, 20_000_000, 1_000_000);
        let ledger = MemoryLedger::with_hold(
            withdrawal.user,
            withdrawal.amount,
            withdrawal.fee,
            &withdrawal.hold_reference,
        );
        let destination = stellar_strkey::ed25519::PublicKey([2; 32])
            .to_string()
            .as_str()
            .to_owned();
        let tx = build_payment(
            &custody.public_key(),
            100,
            &PaymentRequest {
                destination,
                money: withdrawal.amount,
            },
            StellarNetwork::Testnet,
            1_800_000_000,
        )
        .unwrap();
        let (envelope, hash) = sign_withdrawal(tx, &custody, StellarNetwork::Testnet).unwrap();

        Harness {
            server,
            client,
            store: FakeWithdrawalStore::with(withdrawal.clone()),
            ledger,
            withdrawal,
            envelope,
            hash: hash_hex(&hash),
        }
    }

    impl Harness {
        async fn broadcast(&self) -> Result<Broadcast, BroadcastError> {
            broadcast_withdrawal(
                &self.client,
                &self.store,
                &self.ledger,
                self.withdrawal.id,
                &self.envelope,
            )
            .await
        }

        async fn horizon_submit_returns(&self, response: ResponseTemplate) {
            Mock::given(method("POST"))
                .and(path("/transactions"))
                .respond_with(response)
                .mount(&self.server)
                .await;
        }

        async fn horizon_lookup_returns(&self, response: ResponseTemplate) {
            Mock::given(method("GET"))
                .and(path(format!("/transactions/{}", self.hash)))
                .respond_with(response)
                .mount(&self.server)
                .await;
        }

        fn status(&self) -> WithdrawalStatus {
            self.store.snapshot(self.withdrawal.id).status
        }

        fn recorded_hash(&self) -> Option<String> {
            self.store.snapshot(self.withdrawal.id).tx_hash
        }

        fn held(&self) -> i128 {
            self.ledger.balance(self.withdrawal.user, Asset::Usdc).held
        }
    }

    fn rejected(code: &str) -> ResponseTemplate {
        ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "title": "Transaction Failed",
            "status": 400,
            "extras": { "result_codes": { "transaction": code } }
        }))
    }

    #[test]
    fn hashes_are_lower_case_hex() {
        let mut bytes = [0u8; 32];
        bytes[0] = 0xAB;
        bytes[31] = 0x01;
        let hex = hash_hex(&bytes);
        assert_eq!(hex.len(), 64);
        assert!(hex.starts_with("ab00"));
        assert!(hex.ends_with("0001"));
    }

    #[tokio::test]
    async fn an_accepted_withdrawal_stores_the_horizon_hash() {
        let h = harness().await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            // The signed envelope is sent as the form's `tx` field.
            .and(body_string_contains("tx="))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hash": h.hash,
                "ledger": 51_234,
                "successful": true
            })))
            .expect(1)
            .mount(&h.server)
            .await;

        let broadcast = h.broadcast().await.unwrap();

        assert_eq!(
            broadcast,
            Broadcast {
                hash: h.hash.clone(),
                ledger: 51_234
            }
        );
        assert_eq!(h.status(), BroadcastAccepted);
        assert_eq!(h.recorded_hash(), Some(h.hash.clone()));
        assert_eq!(h.held(), 21_000_000, "money stays held until confirmed");
    }

    #[tokio::test]
    async fn a_rejected_withdrawal_fails_and_releases_the_hold() {
        let h = harness().await;
        h.horizon_submit_returns(rejected("tx_insufficient_balance"))
            .await;
        h.horizon_lookup_returns(ResponseTemplate::new(404)).await;

        let err = h.broadcast().await.unwrap_err();

        assert!(
            matches!(&err, BroadcastError::Rejected { detail, .. } if detail.contains("tx_insufficient_balance")),
            "{err:?}"
        );
        assert_eq!(h.status(), Failed);
        assert_eq!(h.recorded_hash(), Some(h.hash.clone()));
        assert_eq!(h.held(), 0);
        assert_eq!(
            h.ledger.hold_state(&h.withdrawal.hold_reference),
            Some(HoldState::Released)
        );
        assert_eq!(
            h.ledger.system(SystemAccount::ExternalOutflow, Asset::Usdc),
            0
        );
    }

    #[tokio::test]
    async fn a_rejected_resubmission_of_a_landed_transaction_is_accepted() {
        let h = harness().await;
        h.horizon_submit_returns(rejected("tx_bad_seq")).await;
        h.horizon_lookup_returns(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "hash": h.hash,
            "ledger": 777,
            "successful": true
        })))
        .await;

        let broadcast = h.broadcast().await.unwrap();

        assert_eq!(broadcast.ledger, 777);
        assert_eq!(h.status(), BroadcastAccepted);
        assert_eq!(h.held(), 21_000_000, "nothing is released");
    }

    #[tokio::test]
    async fn broadcasting_again_after_acceptance_is_a_replay() {
        let h = harness().await;
        h.horizon_submit_returns(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "hash": h.hash,
            "ledger": 9,
        })))
        .await;
        h.broadcast().await.unwrap();

        h.server.reset().await;
        h.horizon_submit_returns(rejected("tx_bad_seq")).await;
        h.horizon_lookup_returns(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "ledger": 9,
            "successful": true
        })))
        .await;

        let again = h.broadcast().await.unwrap();
        assert_eq!(again.hash, h.hash);
        assert_eq!(h.status(), BroadcastAccepted);
    }

    #[tokio::test]
    async fn a_horizon_error_without_an_answer_needs_manual_review() {
        let h = harness().await;
        h.horizon_submit_returns(ResponseTemplate::new(500)).await;

        let err = h.broadcast().await.unwrap_err();

        assert!(matches!(&err, BroadcastError::Unknown { hash, .. } if *hash == h.hash));
        assert_eq!(h.status(), PendingManualReview);
        assert_eq!(h.recorded_hash(), Some(h.hash.clone()), "kept for tracing");
        assert_eq!(
            h.held(),
            21_000_000,
            "it may still land, so nothing is released"
        );
    }

    #[tokio::test]
    async fn a_rejection_that_cannot_be_checked_needs_manual_review() {
        let h = harness().await;
        h.horizon_submit_returns(rejected("tx_bad_seq")).await;
        h.horizon_lookup_returns(ResponseTemplate::new(500)).await;

        let err = h.broadcast().await.unwrap_err();

        assert!(matches!(err, BroadcastError::Unknown { .. }));
        assert_eq!(h.status(), PendingManualReview);
        assert_eq!(h.held(), 21_000_000);
    }

    #[tokio::test]
    async fn a_hash_other_than_the_signed_one_is_not_trusted() {
        let h = harness().await;
        h.horizon_submit_returns(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "hash": "ff".repeat(32),
            "ledger": 9,
        })))
        .await;

        let err = h.broadcast().await.unwrap_err();

        assert!(matches!(err, BroadcastError::Unknown { .. }));
        assert_eq!(h.status(), PendingManualReview);
        assert_eq!(
            h.recorded_hash(),
            Some(h.hash.clone()),
            "the signed hash is recorded"
        );
    }

    #[tokio::test]
    async fn a_finished_withdrawal_is_never_resubmitted() {
        let h = harness().await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&h.server)
            .await;
        h.store
            .transition(h.withdrawal.id, Failed, StatusUpdate::default())
            .await
            .unwrap();

        let err = h.broadcast().await.unwrap_err();
        assert!(matches!(
            err,
            BroadcastError::NotPending { status: Failed, .. }
        ));
    }

    #[tokio::test]
    async fn broadcast_then_confirmation_settles_the_ledger() {
        let h = harness().await;
        h.horizon_submit_returns(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "hash": h.hash,
            "ledger": 60,
        })))
        .await;
        h.horizon_lookup_returns(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "ledger": 60,
            "successful": true
        })))
        .await;

        let broadcast = h.broadcast().await.unwrap();
        let poller = FinalityPoller::with_config(Duration::from_millis(1), Duration::from_secs(5));
        let outcome = poll_transaction_finality(&h.client, &broadcast.hash, &poller).await;
        settlement::apply_finality(&h.store, &h.ledger, h.withdrawal.id, outcome)
            .await
            .unwrap();

        assert_eq!(h.status(), Completed);
        assert_eq!(h.held(), 0);
        assert_eq!(
            h.ledger.system(SystemAccount::ExternalOutflow, Asset::Usdc),
            20_000_000
        );
        assert_eq!(h.ledger.system(SystemAccount::Fees, Asset::Usdc), 1_000_000);
    }

    // ── TxStatus::from_horizon ────────────────────────────────────────────────

    #[test]
    fn ledger_zero_means_not_yet_included() {
        assert_eq!(TxStatus::from_horizon(0, false), TxStatus::NotYetIncluded);
        assert_eq!(TxStatus::from_horizon(0, true), TxStatus::NotYetIncluded);
    }

    #[test]
    fn nonzero_ledger_successful_is_confirmed() {
        assert_eq!(
            TxStatus::from_horizon(42, true),
            TxStatus::IncludedSuccessful { ledger: 42 }
        );
    }

    #[test]
    fn nonzero_ledger_unsuccessful_is_failed() {
        assert_eq!(
            TxStatus::from_horizon(99, false),
            TxStatus::IncludedFailed { ledger: 99 }
        );
    }

    // ── happy path: transaction confirms on the first poll ────────────────────

    #[tokio::test]
    async fn confirms_immediately_when_already_in_ledger() {
        let poller = FinalityPoller::with_config(Duration::from_millis(1), Duration::from_secs(5));

        let result = poller
            .poll("abc123", |_hash| async {
                Ok(TxStatus::IncludedSuccessful { ledger: 12_345 })
            })
            .await
            .unwrap();

        assert_eq!(
            result,
            FinalityOutcome::Confirmed {
                hash: "abc123".to_owned(),
                ledger: 12_345,
            }
        );
    }

    // ── transaction lands after a few polls ───────────────────────────────────

    #[tokio::test]
    async fn confirms_after_several_not_yet_included_responses() {
        // Respond "not yet included" twice, then confirm.
        let call_count = Arc::new(Mutex::new(0u32));
        let poller = FinalityPoller::with_config(Duration::from_millis(1), Duration::from_secs(10));

        let call_count_clone = call_count.clone();
        let result = poller
            .poll("deadbeef", move |_hash| {
                let count = call_count_clone.clone();
                async move {
                    let mut n = count.lock().unwrap();
                    *n = n.saturating_add(1);
                    if *n < 3 {
                        Ok(TxStatus::NotYetIncluded)
                    } else {
                        Ok(TxStatus::IncludedSuccessful { ledger: 77 })
                    }
                }
            })
            .await
            .unwrap();

        assert_eq!(
            result,
            FinalityOutcome::Confirmed {
                hash: "deadbeef".to_owned(),
                ledger: 77,
            }
        );
        // We polled at least 3 times.
        assert!(*call_count.lock().unwrap() >= 3);
    }

    // ── timeout: transaction never lands ─────────────────────────────────────

    #[tokio::test]
    async fn times_out_when_transaction_never_lands() {
        let poller = FinalityPoller::with_config(
            Duration::from_millis(1),
            Duration::from_millis(10), // very short for tests
        );

        let err = poller
            .poll("neverland", |_hash| async { Ok(TxStatus::NotYetIncluded) })
            .await
            .unwrap_err();

        assert!(
            matches!(err, FinalityError::Timeout { ref hash, .. } if hash == "neverland"),
            "expected Timeout, got {err:?}"
        );
    }

    // ── failed transaction in ledger ──────────────────────────────────────────

    #[tokio::test]
    async fn reports_failed_when_included_but_unsuccessful() {
        let poller = FinalityPoller::with_config(Duration::from_millis(1), Duration::from_secs(5));

        let result = poller
            .poll("failedtx", |_hash| async {
                Ok(TxStatus::IncludedFailed { ledger: 55 })
            })
            .await
            .unwrap();

        assert_eq!(
            result,
            FinalityOutcome::Failed {
                hash: "failedtx".to_owned(),
                ledger: 55,
            }
        );
    }

    // ── horizon error aborts the poll ────────────────────────────────────────

    #[tokio::test]
    async fn horizon_error_surfaces_as_finality_error() {
        let poller = FinalityPoller::with_config(Duration::from_millis(1), Duration::from_secs(5));

        let err = poller
            .poll("badtx", |_hash| async {
                Err(ChainError::Unavailable("node down".into()))
            })
            .await
            .unwrap_err();

        // Unavailable is treated as NotYetIncluded inside
        // poll_transaction_finality, but when the raw fetch_fn returns an
        // error directly the poller surfaces FinalityError::Horizon.
        assert!(
            matches!(err, FinalityError::Horizon { ref hash, .. } if hash == "badtx"),
            "expected Horizon error, got {err:?}"
        );
    }

    // ── rejected (non-transient) error from Horizon immediately stops polling ─

    #[tokio::test]
    async fn non_transient_horizon_error_stops_polling_immediately() {
        let call_count = Arc::new(Mutex::new(0u32));
        let poller = FinalityPoller::with_config(
            Duration::from_millis(1),
            Duration::from_secs(60), // long timeout — error should cut it short
        );

        let call_count_clone = call_count.clone();
        let err = poller
            .poll("rejected", move |_hash| {
                let count = call_count_clone.clone();
                async move {
                    let mut n = count.lock().unwrap();
                    *n = n.saturating_add(1);
                    Err(ChainError::Rejected("insufficient fee".into()))
                }
            })
            .await
            .unwrap_err();

        assert!(matches!(err, FinalityError::Horizon { .. }));
        // Must have stopped after the first call.
        assert_eq!(*call_count.lock().unwrap(), 1);
    }

    // ── confirms at the last moment before timeout ────────────────────────────

    #[tokio::test]
    async fn confirms_on_the_final_poll_before_timeout() {
        let call_count = Arc::new(Mutex::new(0u32));
        // Timeout = 50 ms, interval = 10 ms → up to ~5 polls.
        let poller =
            FinalityPoller::with_config(Duration::from_millis(10), Duration::from_millis(50));

        let call_count_clone = call_count.clone();
        let result = poller
            .poll("lastchance", move |_hash| {
                let count = call_count_clone.clone();
                async move {
                    let n = {
                        let mut guard = count.lock().unwrap();
                        *guard = guard.saturating_add(1);
                        *guard
                    };
                    if n < 4 {
                        Ok(TxStatus::NotYetIncluded)
                    } else {
                        Ok(TxStatus::IncludedSuccessful { ledger: 99 })
                    }
                }
            })
            .await;

        // Either confirms or times out — both are valid depending on timing,
        // but must not panic.
        match result {
            Ok(FinalityOutcome::Confirmed { ledger: 99, .. }) => {}
            Err(FinalityError::Timeout { .. }) => {}
            other => panic!("unexpected result: {other:?}"),
        }
    }

    // ── TxStatus::from_horizon edge cases ─────────────────────────────────────

    #[test]
    fn from_horizon_max_ledger_successful() {
        assert_eq!(
            TxStatus::from_horizon(u64::MAX, true),
            TxStatus::IncludedSuccessful { ledger: u64::MAX }
        );
    }

    #[test]
    fn from_horizon_ledger_1_is_not_zero() {
        assert_eq!(
            TxStatus::from_horizon(1, true),
            TxStatus::IncludedSuccessful { ledger: 1 }
        );
    }
}
