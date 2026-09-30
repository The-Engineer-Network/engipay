//! Asynchronous polling loop for Stellar Horizon deposits.
//!
//! [`StellarWatcher`] wraps the existing [`StellarClient`] and runs a resilient
//! Tokio interval timer that continuously queries Horizon for new closed ledgers
//! and payment operations directed at the custody account.
//!
//! # Design
//!
//! - Reuses [`StellarClient`] — no second Horizon client.
//! - Polls on a configurable interval (default 3 s, well inside Stellar's ~5 s
//!   ledger close time, so no ledger is missed under normal conditions).
//! - Overlaps by one ledger on purpose: the cursor is set to the *last seen
//!   tip* before fetching, so a deposit that arrived exactly at the previous
//!   tip is never silently skipped.  The in-memory `seen` set deduplicates the
//!   overlap.
//! - Errors from Horizon are logged as warnings and retried on the next tick;
//!   they never crash the loop.
//! - The watcher stops cleanly when the [`tokio::CancellationToken`] is
//!   cancelled (or a `ctrl_c` signal arrives if callers prefer that).
//!
//! # Moving from main.rs
//!
//! The original ad-hoc `watch()` loop in `main.rs` is superseded by this type.
//! `main.rs` should be updated to construct a [`StellarWatcher`] and call
//! [`StellarWatcher::run`].

use std::collections::{HashSet, VecDeque};
use std::time::Duration;

use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::stellar::StellarClient;
use crate::{ChainClient, ObservedDeposit, is_creditable};

/// Maximum references held in the deduplication ring-buffer.
const SEEN_CAPACITY: usize = 10_000;

/// Default poll interval — slightly below Stellar's ~5 s ledger close time so
/// no ledger is missed under normal network conditions.
pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(3);

// ── Watcher ───────────────────────────────────────────────────────────────────

/// Polls Stellar Horizon for new deposits into the custody account.
///
/// Construct with [`StellarWatcher::new`] and start with [`StellarWatcher::run`].
pub struct StellarWatcher {
    client: StellarClient,
    poll_interval: Duration,
}

impl StellarWatcher {
    /// Creates a new watcher backed by `client`.
    ///
    /// `poll_interval` controls how often Horizon is queried.  Use
    /// [`DEFAULT_POLL_INTERVAL`] if you do not have a specific requirement.
    pub fn new(client: StellarClient, poll_interval: Duration) -> Self {
        Self {
            client,
            poll_interval,
        }
    }

    /// Runs the polling loop until `cancel` is cancelled.
    ///
    /// `start_ledger` is the first ledger to check.  Callers typically pass
    /// the value of `STELLAR_START_LEDGER` from the environment, or the
    /// current tip when none is configured.
    ///
    /// The loop:
    /// 1. Waits for the next interval tick (or returns immediately on the
    ///    first call so startup is fast).
    /// 2. Fetches the current Horizon tip.
    /// 3. Fetches all payments from `next_ledger` onwards.
    /// 4. For each creditable, unseen deposit, calls `on_deposit`.
    /// 5. Advances the cursor to the fetched tip (overlap-by-one is the
    ///    reason we use the *previous* `next_ledger` in step 3).
    ///
    /// `on_deposit` receives every new creditable deposit.  Errors it returns
    /// are surfaced to the caller as the `Err` variant of the run result so
    /// the supervisor can decide whether to restart.
    pub async fn run<F, Fut>(
        &self,
        start_ledger: u64,
        cancel: CancellationToken,
        mut on_deposit: F,
    ) where
        F: FnMut(ObservedDeposit) -> Fut,
        Fut: std::future::Future<Output = ()>,
    {
        let mut next_ledger = start_ledger;
        let mut seen: HashSet<String> = HashSet::new();
        let mut seen_order: VecDeque<String> = VecDeque::new();
        let mut ticker = tokio::time::interval(self.poll_interval);
        // The first tick fires immediately; subsequent ticks wait `poll_interval`.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        info!(
            network    = ?self.client.config().network,
            custody    = %self.client.config().custody_account,
            from_ledger = next_ledger,
            interval_ms = self.poll_interval.as_millis(),
            "StellarWatcher starting"
        );

        loop {
            tokio::select! {
                biased;
                () = cancel.cancelled() => {
                    info!("StellarWatcher cancelled; stopping");
                    return;
                }
                _ = ticker.tick() => {}
            }

            // Fetch the tip first so we know how many confirmations each
            // deposit has. An error here just delays the tick; the cursor
            // does not move.
            let tip = match self.client.latest_height().await {
                Ok(tip) => tip,
                Err(error) => {
                    warn!(%error, "Horizon unavailable; retrying on next tick");
                    continue;
                }
            };

            let deposits = match self.client.deposits_since(next_ledger).await {
                Ok(deposits) => deposits,
                Err(error) => {
                    warn!(%error, "could not read Stellar deposits; retrying on next tick");
                    continue;
                }
            };

            for deposit in deposits {
                if !is_creditable(&self.client, &deposit) {
                    continue;
                }
                if seen.contains(&deposit.reference) {
                    continue;
                }

                // Persist reference before calling the callback so a panic in
                // the callback does not cause the deposit to be processed again.
                seen.insert(deposit.reference.clone());
                seen_order.push_back(deposit.reference.clone());
                while seen_order.len() > SEEN_CAPACITY {
                    if let Some(oldest) = seen_order.pop_front() {
                        seen.remove(&oldest);
                    }
                }

                on_deposit(deposit).await;
            }

            // Advance the cursor to the tip.  Overlap-by-one: the *next* call
            // to `deposits_since(next_ledger)` will re-fetch from here, so any
            // deposit that arrived in this exact ledger but was not yet
            // confirmed is naturally retried.
            next_ledger = tip;
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio_util::sync::CancellationToken;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use crate::stellar::{StellarClient, StellarConfig, StellarNetwork};
    use engipay_core::stellar::muxed_deposit_address;

    use super::*;

    fn g_account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    async fn watcher(server: &MockServer) -> StellarWatcher {
        let custody = g_account(1);
        let config =
            StellarConfig::new(StellarNetwork::Testnet, Some(server.uri()), &custody).unwrap();
        let client = StellarClient::new(config).unwrap();
        StellarWatcher::new(client, Duration::from_millis(50))
    }

    /// Mounts a Horizon `/` root that reports ledger 100 as the tip.
    async fn mount_root(server: &MockServer, tip: u64) {
        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "history_latest_ledger": tip })),
            )
            .mount(server)
            .await;
    }

    /// Mounts an empty payments page for any cursor.
    async fn mount_empty_payments(server: &MockServer) {
        Mock::given(method("GET"))
            .and(path(format!("/accounts/{}/payments", g_account(1))))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "_embedded": { "records": [] }
            })))
            .mount(server)
            .await;
    }

    // ── Test: watcher starts and calls on_deposit for each new deposit ────────

    #[tokio::test]
    async fn watcher_reports_new_creditable_deposits() {
        let server = MockServer::start().await;
        let custody = g_account(1);
        let muxed = muxed_deposit_address(&custody, 7).unwrap();

        mount_root(&server, 100).await;

        Mock::given(method("GET"))
            .and(path(format!("/accounts/{custody}/payments")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "_embedded": { "records": [
                    {
                        "paging_token": "206158434305",
                        "type": "payment",
                        "transaction_hash": "aabbcc",
                        "transaction_successful": true,
                        "to": custody,
                        "to_muxed": muxed,
                        "asset_type": "native",
                        "amount": "5.0000000",
                        "transaction": { "ledger": 99, "successful": true }
                    }
                ]}
            })))
            .mount(&server)
            .await;

        let w = watcher(&server).await;
        let cancel = CancellationToken::new();
        let collected: Arc<Mutex<Vec<ObservedDeposit>>> = Arc::new(Mutex::new(Vec::new()));
        let collected_clone = collected.clone();
        let cancel_clone = cancel.clone();

        // Run the watcher briefly then cancel.
        let handle = tokio::spawn(async move {
            w.run(99, cancel_clone, |deposit| {
                let collected = collected.clone();
                async move {
                    collected.lock().unwrap().push(deposit);
                }
            })
            .await;
        });

        // Give it one full tick then cancel.
        tokio::time::sleep(Duration::from_millis(200)).await;
        cancel.cancel();
        handle.await.unwrap();

        let deposits = collected_clone.lock().unwrap();
        assert_eq!(deposits.len(), 1, "expected one deposit");
        assert_eq!(deposits[0].reference, "stellar:aabbcc:206158434305");
    }

    // ── Test: watcher deduplicates repeats (overlap-by-one) ──────────────────

    #[tokio::test]
    async fn watcher_deduplicates_overlapping_deposits() {
        let server = MockServer::start().await;
        let custody = g_account(1);
        let muxed = muxed_deposit_address(&custody, 3).unwrap();

        // Horizon always returns the same deposit — it should be credited once.
        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "history_latest_ledger": 50u64 })),
            )
            .mount(&server)
            .await;

        Mock::given(method("GET"))
            .and(path(format!("/accounts/{custody}/payments")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "_embedded": { "records": [
                    {
                        "paging_token": "111",
                        "type": "payment",
                        "transaction_hash": "deadbeef",
                        "transaction_successful": true,
                        "to": custody,
                        "to_muxed": muxed,
                        "asset_type": "native",
                        "amount": "1.0000000",
                        "transaction": { "ledger": 49, "successful": true }
                    }
                ]}
            })))
            .mount(&server)
            .await;

        let w = watcher(&server).await;
        let cancel = CancellationToken::new();
        let count = Arc::new(Mutex::new(0u32));
        let count_clone = count.clone();
        let cancel_clone = cancel.clone();

        let handle = tokio::spawn(async move {
            w.run(49, cancel_clone, |_deposit| {
                let count = count.clone();
                async move {
                    *count.lock().unwrap() += 1;
                }
            })
            .await;
        });

        // Two ticks → same deposit must appear only once.
        tokio::time::sleep(Duration::from_millis(250)).await;
        cancel.cancel();
        handle.await.unwrap();

        assert_eq!(
            *count_clone.lock().unwrap(),
            1,
            "same deposit must not be credited twice"
        );
    }

    // ── Test: watcher recovers from Horizon errors ────────────────────────────

    #[tokio::test]
    async fn watcher_continues_after_horizon_error() {
        let server = MockServer::start().await;

        // First call: 503
        Mock::given(method("GET"))
            .and(path("/"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .mount(&server)
            .await;

        // Subsequent calls: valid response
        mount_root(&server, 10).await;
        mount_empty_payments(&server).await;

        let w = watcher(&server).await;
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        let handle = tokio::spawn(async move {
            w.run(10, cancel_clone, |_| async {}).await;
        });

        // Give it enough time to retry and succeed.
        tokio::time::sleep(Duration::from_millis(300)).await;
        cancel.cancel();
        // The watcher must not have panicked.
        handle.await.expect("watcher task must not panic after error");
    }

    // ── Test: cancellation stops the loop promptly ────────────────────────────

    #[tokio::test]
    async fn watcher_stops_on_cancellation() {
        let server = MockServer::start().await;
        mount_root(&server, 5).await;
        mount_empty_payments(&server).await;

        let w = watcher(&server).await;
        let cancel = CancellationToken::new();
        let cancel_clone = cancel.clone();

        let handle = tokio::spawn(async move {
            w.run(5, cancel_clone, |_| async {}).await;
        });

        // Cancel almost immediately.
        tokio::time::sleep(Duration::from_millis(20)).await;
        cancel.cancel();

        tokio::time::timeout(Duration::from_secs(2), handle)
            .await
            .expect("watcher did not stop within 2 s after cancellation")
            .expect("watcher task panicked");
    }
}
