//! Daily ledger reconciliation against on-chain custody balances.
//!
//! Each run:
//!   1. Fetches the custody account's current balances from each configured chain.
//!   2. Queries `ledger_postings` for the total user liability per asset.
//!   3. Computes `discrepancy = custody_balance - ledger_liability`.
//!   4. Persists the result in `reconciliation_runs`.
//!   5. Logs at `error!` if the discrepancy is negative (shortfall) or exceeds
//!      the configured surplus tolerance, so alert pipelines can fire.
//!
//! The worker follows the same `run()` + `tick()` pattern as
//! [`super::withdrawal::WithdrawalWorker`] and uses a [`CancellationToken`] for
//! clean shutdown.

use std::time::Duration;

use engipay_core::Asset;
use engipay_ledger::postgres::PostgresLedgerStore;
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::bitcoin::BitcoinEsploraClient;
use crate::evm::BaseClient;
use crate::stellar::StellarClient;

/// Default reconciliation interval — once every 24 hours.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// Maximum discrepancy (in asset smallest units) before a surplus triggers a
/// warning. A small surplus is normal float; a very large one may indicate
/// unprocessed deposits or accounting errors. Set via
/// `RECONCILE_SURPLUS_TOLERANCE` (default 0 = warn on any surplus too).
///
/// A shortfall (negative discrepancy) always triggers an `error!` regardless
/// of this value.
const DEFAULT_SURPLUS_TOLERANCE: i128 = 0;
/// The result of a single reconciliation pass for one asset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetReport {
    pub asset: Asset,
    /// What the ledger says EngiPay owes users (sum of all user postings).
    pub ledger_liability: i128,
    /// What Horizon reports the custody account holds.
    pub custody_balance: i128,
    /// `custody_balance - ledger_liability`. Negative = shortfall.
    pub discrepancy: i128,
}

impl AssetReport {
    fn new(asset: Asset, ledger_liability: i128, custody_balance: i128) -> Self {
        let discrepancy = custody_balance.wrapping_sub(ledger_liability);
        Self {
            asset,
            ledger_liability,
            custody_balance,
            discrepancy,
        }
    }
}

/// Errors that can occur during a reconciliation tick.
#[derive(Debug, thiserror::Error)]
pub enum ReconcileError {
    #[error("could not read ledger liabilities: {0}")]
    Ledger(#[from] engipay_ledger::LedgerError),
    #[error("could not read Stellar custody balance: {0}")]
    Chain(#[from] crate::ChainError),
}

/// Reconciles the ledger against on-chain custody balances on a configurable interval.
///
/// Stellar is always reconciled when a `StellarClient` is provided. Base and
/// Bitcoin are reconciled only when their respective clients are set via
/// [`ReconcileWorker::with_base`] and [`ReconcileWorker::with_bitcoin`].
pub struct ReconcileWorker {
    store: PostgresLedgerStore,
    stellar: StellarClient,
    base: Option<BaseClient>,
    bitcoin: Option<BitcoinEsploraClient>,
    surplus_tolerance: i128,
}

impl ReconcileWorker {
    pub fn new(pool: PgPool, stellar: StellarClient) -> Self {
        let surplus_tolerance = std::env::var("RECONCILE_SURPLUS_TOLERANCE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(DEFAULT_SURPLUS_TOLERANCE);
        Self {
            store: PostgresLedgerStore::new(pool),
            stellar,
            base: None,
            bitcoin: None,
            surplus_tolerance,
        }
    }

    /// Attaches a Base client so ETH and USDC on Base are reconciled each tick.
    pub fn with_base(mut self, client: BaseClient) -> Self {
        self.base = Some(client);
        self
    }

    /// Attaches a Bitcoin Esplora client so BTC is reconciled each tick.
    pub fn with_bitcoin(mut self, client: BitcoinEsploraClient) -> Self {
        self.bitcoin = Some(client);
        self
    }

    /// Runs reconciliation on `interval` until `shutdown` fires.
    ///
    /// The first tick fires immediately on entry so the first report appears in
    /// logs right after startup rather than after one full interval.
    pub async fn run(&self, interval: Duration, shutdown: CancellationToken) {
        let mut ticker = tokio::time::interval(interval);
        // Skip missed ticks: if the service is paused longer than `interval`,
        // run once when it wakes rather than catching up.
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                () = shutdown.cancelled() => {
                    info!("reconciliation worker shutting down");
                    return;
                }
                _ = ticker.tick() => {}
            }

            match self.tick().await {
                Ok(reports) => {
                    info!(assets = reports.len(), "reconciliation run complete");
                }
                Err(error) => {
                    warn!(%error, "reconciliation run failed; will retry next interval");
                }
            }
        }
    }

    /// Runs one full reconciliation pass.
    ///
    /// Fetches Stellar custody balances and ledger liabilities, persists each
    /// result, and emits structured alert logs for any discrepancy outside
    /// tolerance.
    pub async fn tick(&self) -> Result<Vec<AssetReport>, ReconcileError> {
        // --- 1. Fetch on-chain custody balances from all configured chains ---
        let mut chain_map: std::collections::HashMap<Asset, i128> = std::collections::HashMap::new();

        // Stellar (always present).
        for (asset, balance) in self.stellar.custody_balances().await? {
            *chain_map.entry(asset).or_insert(0) += balance;
        }

        // Base (optional).
        if let Some(ref base) = self.base {
            match base.custody_balances().await {
                Ok(balances) => {
                    for (asset, balance) in balances {
                        *chain_map.entry(asset).or_insert(0) += balance;
                    }
                }
                Err(e) => {
                    warn!(error = %e, "could not read Base custody balances; skipping Base in this run");
                }
            }
        }

        // Bitcoin (optional).
        if let Some(ref btc) = self.bitcoin {
            match btc.custody_balance_sats().await {
                Ok(sats) => {
                    *chain_map.entry(Asset::Btc).or_insert(0) += i128::from(sats);
                }
                Err(e) => {
                    warn!(error = %e, "could not read Bitcoin custody balance; skipping BTC in this run");
                }
            }
        }

        // --- 2. Fetch ledger liabilities ---
        let liabilities = self.store.total_liability_by_asset().await?;

        // Build a lookup: asset → ledger total
        let mut liability_map: std::collections::HashMap<Asset, i128> =
            liabilities.into_iter().collect();

        // All assets that could appear across any configured chain.
        let all_assets: Vec<Asset> = Asset::ALL.into_iter().collect();

        // Only report assets that appear in either the chain map or the ledger.
        let mut reports = Vec::with_capacity(all_assets.len());

        for asset in all_assets {
            // Skip assets with no data from any source this run.
            if !chain_map.contains_key(&asset) && !liability_map.contains_key(&asset) {
                continue;
            }
            let ledger_liability = liability_map.remove(&asset).unwrap_or(0);
            let custody_balance = chain_map.remove(&asset).unwrap_or(0);

            let report = AssetReport::new(asset, ledger_liability, custody_balance);

            // --- 3. Emit alert logs ---
            if report.discrepancy < 0 {
                error!(
                    %asset,
                    ledger_liability = %report.ledger_liability,
                    custody_balance  = %report.custody_balance,
                    discrepancy      = %report.discrepancy,
                    alert            = "custody_reconciliation_shortfall",
                    "RECONCILIATION: custody balance is below ledger liabilities — shortfall requires immediate review"
                );
            } else if report.discrepancy > self.surplus_tolerance {
                warn!(
                    %asset,
                    ledger_liability = %report.ledger_liability,
                    custody_balance  = %report.custody_balance,
                    discrepancy      = %report.discrepancy,
                    surplus_tolerance = %self.surplus_tolerance,
                    "RECONCILIATION: custody surplus exceeds tolerance — may indicate unprocessed deposits"
                );
            } else {
                info!(
                    %asset,
                    ledger_liability = %report.ledger_liability,
                    custody_balance  = %report.custody_balance,
                    discrepancy      = %report.discrepancy,
                    "reconciliation OK"
                );
            }

            // --- 4. Persist the run ---
            self.store
                .record_reconciliation_run(asset.symbol(), ledger_liability, custody_balance)
                .await?;

            reports.push(report);
        }

        Ok(reports)
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn asset_report_computes_discrepancy() {
        let r = AssetReport::new(Asset::Xlm, 1_000, 1_050);
        assert_eq!(r.discrepancy, 50);
        assert_eq!(r.custody_balance, 1_050);
        assert_eq!(r.ledger_liability, 1_000);
    }

    #[test]
    fn asset_report_shortfall_is_negative() {
        let r = AssetReport::new(Asset::Usdc, 5_000, 4_900);
        assert_eq!(r.discrepancy, -100);
    }

    #[test]
    fn asset_report_balanced() {
        let r = AssetReport::new(Asset::Xlm, 9_999, 9_999);
        assert_eq!(r.discrepancy, 0);
    }
}
