//! Daily ledger reconciliation against on-chain Stellar custody balances.
//!
//! Each run:
//!   1. Fetches the custody account's current balances from Horizon.
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

/// Reconciles the ledger against on-chain Stellar custody balances on a
/// configurable interval.
pub struct ReconcileWorker {
    store: PostgresLedgerStore,
    stellar: StellarClient,
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
            surplus_tolerance,
        }
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
        // --- 1. Fetch on-chain custody balances ---
        let chain_balances = self.stellar.custody_balances().await?;

        // --- 2. Fetch ledger liabilities ---
        let liabilities = self.store.total_liability_by_asset().await?;

        // Build a lookup: asset → ledger total
        let mut liability_map: std::collections::HashMap<Asset, i128> =
            liabilities.into_iter().collect();

        // Build a lookup: asset → on-chain balance
        let mut chain_map: std::collections::HashMap<Asset, i128> =
            chain_balances.into_iter().collect();

        // Union of all assets seen from either source (Stellar assets only).
        let stellar_assets: Vec<Asset> = Asset::ALL
            .into_iter()
            .filter(|a| a.is_on(engipay_core::Chain::Stellar))
            .collect();

        let mut reports = Vec::with_capacity(stellar_assets.len());

        for asset in stellar_assets {
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
