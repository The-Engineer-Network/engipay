//! Withdrawal worker: broadcasts pending outflows.
//!
//! Polls `withdrawals` for rows with `status = 'pending_broadcast'`, claims
//! them with `SELECT … FOR UPDATE SKIP LOCKED`, and hands each one to the
//! [`WithdrawalSender`] registered for its chain.
//!
//! # Claiming
//!
//! ```text
//!   pending_broadcast ──claim──► broadcasting ──► broadcast_accepted
//!          ▲                         │  │  └────► failed
//!          └────── Retry ────────────┘  └───────► pending_manual_review
//! ```
//!
//! The claim is one statement: the inner `SELECT … FOR UPDATE SKIP LOCKED`
//! picks rows no other worker holds, and the outer `UPDATE` moves them to
//! `broadcasting` before the statement commits. Two workers polling at the
//! same moment therefore take disjoint rows, and once committed the status
//! alone keeps the row from being claimed again.
//!
//! Only chains with a registered sender are claimed, so a deployment without
//! a Bitcoin sender leaves Bitcoin withdrawals untouched.
//!
//! # Never paying twice
//!
//! A row only goes back to `pending_broadcast` when the sender knows nothing
//! reached the network ([`DispatchOutcome::Retry`]). If a submission may have
//! landed ([`DispatchOutcome::Ambiguous`]) the row goes to
//! `pending_manual_review` with the transaction hash, because signing again
//! would use a new sequence number and pay twice. For the same reason a row
//! left in `broadcasting` by a crash is never picked up again automatically.
//!
//! # Cooling-off
//!
//! Each poll first moves `cooling_off` rows whose `cooling_off_until` has
//! passed back to `pending_broadcast`, so they go out in the same poll.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use engipay_core::{Asset, Chain, Money};
use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::ChainError;
use crate::stellar::StellarClient;
use crate::stellar::payment::{PaymentRequest, StellarMemo, StellarSigner};

/// Withdrawals claimed per poll.
pub const DEFAULT_BATCH_SIZE: i64 = 10;

/// Time between polls.
pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// A claimed withdrawal, decoded and ready to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingWithdrawal {
    pub id: Uuid,
    pub chain: Chain,
    pub money: Money,
    pub destination: String,
    pub memo: Option<String>,
}

/// What happened when a sender tried to broadcast a withdrawal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchOutcome {
    /// The network accepted the transaction.
    Accepted { tx_hash: String },
    /// The network refused it, or the withdrawal can never be sent as-is.
    Rejected { reason: String },
    /// Failed before anything was submitted; safe to try again next poll.
    Retry { reason: String },
    /// Submission may or may not have reached the network. Needs a human (or
    /// the finality poller) to look at `tx_hash` before anything is re-signed.
    Ambiguous {
        tx_hash: Option<String>,
        reason: String,
    },
}

/// A boxed future returned by [`WithdrawalSender::send`].
pub type SendFuture<'a> = Pin<Box<dyn Future<Output = DispatchOutcome> + Send + 'a>>;

/// Broadcasts withdrawals on one chain.
pub trait WithdrawalSender: Send + Sync {
    fn chain(&self) -> Chain;
    fn send<'a>(&'a self, withdrawal: &'a PendingWithdrawal) -> SendFuture<'a>;
}

/// What one poll did, for logs and tests.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct TickReport {
    pub requeued: u64,
    pub accepted: usize,
    pub rejected: usize,
    pub retried: usize,
    pub ambiguous: usize,
}

impl TickReport {
    pub fn dispatched(&self) -> usize {
        self.accepted
            .saturating_add(self.rejected)
            .saturating_add(self.retried)
            .saturating_add(self.ambiguous)
    }
}

/// Polls `withdrawals` and dispatches pending rows to chain senders.
pub struct WithdrawalWorker {
    pool: PgPool,
    senders: HashMap<Chain, Arc<dyn WithdrawalSender>>,
    batch_size: i64,
}

impl WithdrawalWorker {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            senders: HashMap::new(),
            batch_size: DEFAULT_BATCH_SIZE,
        }
    }

    /// Registers the sender for its chain, replacing any earlier one.
    #[must_use]
    pub fn with_sender(mut self, sender: Arc<dyn WithdrawalSender>) -> Self {
        self.senders.insert(sender.chain(), sender);
        self
    }

    #[must_use]
    pub fn with_batch_size(mut self, batch_size: i64) -> Self {
        self.batch_size = batch_size.max(1);
        self
    }

    /// Polls every `interval` until `shutdown` is cancelled.
    pub async fn run(&self, interval: Duration, shutdown: CancellationToken) {
        let mut ticker = tokio::time::interval(interval);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                () = shutdown.cancelled() => {
                    info!("withdrawal worker shutting down");
                    return;
                }
                _ = ticker.tick() => {}
            }
            match self.tick().await {
                Ok(report) if report.dispatched() > 0 || report.requeued > 0 => {
                    info!(?report, "withdrawal poll finished");
                }
                Ok(_) => {}
                Err(error) => warn!(%error, "withdrawal poll failed; retrying next interval"),
            }
        }
    }

    /// One poll: release expired cooling-off holds, then claim and dispatch a
    /// batch.
    pub async fn tick(&self) -> Result<TickReport, sqlx::Error> {
        let mut report = TickReport {
            requeued: requeue_expired_cooling_off(&self.pool).await?,
            ..TickReport::default()
        };

        let chains: Vec<&'static str> =
            self.senders.keys().map(|chain| chain_key(*chain)).collect();
        if chains.is_empty() {
            return Ok(report);
        }

        for row in claim_batch(&self.pool, &chains, self.batch_size).await? {
            let id = row.id;
            let outcome = match row.decode() {
                Ok(withdrawal) => self.dispatch(&withdrawal).await,
                Err(reason) => DispatchOutcome::Rejected { reason },
            };
            let counter = match &outcome {
                DispatchOutcome::Accepted { .. } => &mut report.accepted,
                DispatchOutcome::Rejected { .. } => &mut report.rejected,
                DispatchOutcome::Retry { .. } => &mut report.retried,
                DispatchOutcome::Ambiguous { .. } => &mut report.ambiguous,
            };
            *counter = counter.saturating_add(1);
            if let Err(error) = record_outcome(&self.pool, id, &outcome).await {
                // The row stays in `broadcasting`, which is the safe place for
                // it: nothing will sign it again without a human looking.
                error!(%id, %error, ?outcome, "could not record withdrawal outcome");
            }
        }
        Ok(report)
    }

    /// Hands one withdrawal to its chain's sender.
    pub async fn dispatch(&self, withdrawal: &PendingWithdrawal) -> DispatchOutcome {
        let Some(sender) = self.senders.get(&withdrawal.chain) else {
            return DispatchOutcome::Retry {
                reason: format!("no sender configured for {:?}", withdrawal.chain),
            };
        };
        let outcome = sender.send(withdrawal).await;
        match &outcome {
            DispatchOutcome::Accepted { tx_hash } => {
                info!(id = %withdrawal.id, %tx_hash, "withdrawal broadcast accepted");
            }
            DispatchOutcome::Rejected { reason } => {
                warn!(id = %withdrawal.id, %reason, "withdrawal rejected");
            }
            DispatchOutcome::Retry { reason } => {
                warn!(id = %withdrawal.id, %reason, "withdrawal not sent; will retry");
            }
            DispatchOutcome::Ambiguous { tx_hash, reason } => {
                error!(
                    id = %withdrawal.id,
                    ?tx_hash,
                    %reason,
                    alert = "withdrawal_ambiguous_broadcast",
                    "withdrawal may have been broadcast; sent to manual review"
                );
            }
        }
        outcome
    }
}

// ── Stellar ──────────────────────────────────────────────────────────────────

/// Sends XLM and USDC withdrawals on Stellar.
pub struct StellarWithdrawalSender {
    client: StellarClient,
    signer: Arc<dyn StellarSigner>,
}

impl StellarWithdrawalSender {
    pub fn new(client: StellarClient, signer: Arc<dyn StellarSigner>) -> Self {
        Self { client, signer }
    }

    async fn send_stellar(&self, withdrawal: &PendingWithdrawal) -> DispatchOutcome {
        if !matches!(withdrawal.money.asset, Asset::Xlm | Asset::Usdc) {
            return DispatchOutcome::Rejected {
                reason: format!("{} cannot be sent on Stellar", withdrawal.money.asset),
            };
        }
        let request = PaymentRequest {
            destination: withdrawal.destination.clone(),
            money: withdrawal.money,
            memo: withdrawal.memo.as_deref().map(stellar_memo),
        };

        let prepared = match self
            .client
            .prepare_payment(self.signer.as_ref(), &request)
            .await
        {
            Ok(prepared) => prepared,
            // Nothing was submitted, so either retry or give up cleanly.
            Err(ChainError::Rejected(reason)) => return DispatchOutcome::Rejected { reason },
            Err(error) => {
                return DispatchOutcome::Retry {
                    reason: error.to_string(),
                };
            }
        };

        match self.client.submit_prepared(&prepared).await {
            Ok(tx_hash) => DispatchOutcome::Accepted { tx_hash },
            Err(ChainError::Rejected(reason)) => DispatchOutcome::Rejected { reason },
            Err(error) => DispatchOutcome::Ambiguous {
                tx_hash: Some(prepared.hash),
                reason: error.to_string(),
            },
        }
    }
}

impl WithdrawalSender for StellarWithdrawalSender {
    fn chain(&self) -> Chain {
        Chain::Stellar
    }

    fn send<'a>(&'a self, withdrawal: &'a PendingWithdrawal) -> SendFuture<'a> {
        Box::pin(self.send_stellar(withdrawal))
    }
}

/// A stored memo that is all digits and fits a `u64` becomes an ID memo, as
/// exchanges expect; anything else is a text memo.
pub fn stellar_memo(memo: &str) -> StellarMemo {
    let is_id = !memo.is_empty() && memo.bytes().all(|byte| byte.is_ascii_digit());
    match memo.parse::<u64>() {
        Ok(id) if is_id => StellarMemo::Id(id),
        _ => StellarMemo::Text(memo.to_owned()),
    }
}

// ── Database ─────────────────────────────────────────────────────────────────

/// A claimed row as stored, before decoding.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ClaimedRow {
    pub id: Uuid,
    pub chain: String,
    pub asset: String,
    pub amount: String,
    pub destination: String,
    pub memo: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl ClaimedRow {
    /// Decodes the row, or explains why it can never be sent.
    pub fn decode(self) -> Result<PendingWithdrawal, String> {
        let chain =
            parse_chain(&self.chain).ok_or_else(|| format!("unknown chain {:?}", self.chain))?;
        let asset: Asset = self.asset.parse().map_err(|error| format!("{error}"))?;
        let minor: i128 = self
            .amount
            .parse()
            .map_err(|_| format!("amount {:?} is out of range", self.amount))?;
        if minor <= 0 {
            return Err(format!("amount {minor} is not positive"));
        }
        Ok(PendingWithdrawal {
            id: self.id,
            chain,
            money: Money::from_minor(asset, minor),
            destination: self.destination,
            memo: self.memo,
        })
    }
}

/// The `withdrawals.chain` value for a chain.
pub const fn chain_key(chain: Chain) -> &'static str {
    match chain {
        Chain::Base => "base",
        Chain::Bitcoin => "bitcoin",
        Chain::Stellar => "stellar",
    }
}

fn parse_chain(value: &str) -> Option<Chain> {
    Chain::ALL
        .into_iter()
        .find(|chain| chain_key(*chain) == value)
}

/// Claims up to `limit` `pending_broadcast` withdrawals on `chains`, oldest
/// first, moving them to `broadcasting`. Rows another transaction holds a lock
/// on are skipped rather than waited for.
pub async fn claim_batch(
    pool: &PgPool,
    chains: &[&str],
    limit: i64,
) -> Result<Vec<ClaimedRow>, sqlx::Error> {
    let mut rows: Vec<ClaimedRow> = sqlx::query_as(
        "UPDATE withdrawals
         SET status = 'broadcasting', updated_at = now()
         WHERE id IN (
             SELECT id FROM withdrawals
             WHERE status = 'pending_broadcast' AND chain = ANY($1)
             ORDER BY created_at ASC
             LIMIT $2
             FOR UPDATE SKIP LOCKED
         )
         RETURNING id, chain, asset, amount::text AS amount, destination, memo, created_at",
    )
    .bind(chains)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    // RETURNING does not preserve the subquery's order.
    rows.sort_by_key(|row| row.created_at);
    Ok(rows)
}

/// Moves `cooling_off` withdrawals whose hold has ended back to
/// `pending_broadcast`.
pub async fn requeue_expired_cooling_off(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE withdrawals
         SET status = 'pending_broadcast', cooling_off_until = NULL, updated_at = now()
         WHERE status = 'cooling_off' AND cooling_off_until <= now()",
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Moves a `broadcasting` withdrawal to wherever `outcome` says it belongs.
pub async fn record_outcome(
    pool: &PgPool,
    id: Uuid,
    outcome: &DispatchOutcome,
) -> Result<(), sqlx::Error> {
    let (status, tx_hash, reason) = match outcome {
        DispatchOutcome::Accepted { tx_hash } => {
            ("broadcast_accepted", Some(tx_hash.as_str()), None)
        }
        DispatchOutcome::Rejected { reason } => ("failed", None, Some(reason.as_str())),
        DispatchOutcome::Retry { .. } => ("pending_broadcast", None, None),
        DispatchOutcome::Ambiguous { tx_hash, reason } => (
            "pending_manual_review",
            tx_hash.as_deref(),
            Some(reason.as_str()),
        ),
    };
    sqlx::query(
        "UPDATE withdrawals
         SET status = $2,
             tx_hash = COALESCE($3, tx_hash),
             failure_reason = COALESCE($4, failure_reason),
             updated_at = now()
         WHERE id = $1 AND status = 'broadcasting'",
    )
    .bind(id)
    .bind(status)
    .bind(tx_hash)
    .bind(reason)
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use std::sync::Mutex;

    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::stellar::payment::LocalTestnetSigner;
    use crate::stellar::{StellarConfig, StellarNetwork};

    /// Records every withdrawal it sees and answers with a fixed outcome.
    struct FakeSender {
        chain: Chain,
        outcome: DispatchOutcome,
        sent: Mutex<Vec<Uuid>>,
    }

    impl FakeSender {
        fn new(chain: Chain, outcome: DispatchOutcome) -> Arc<Self> {
            Arc::new(Self {
                chain,
                outcome,
                sent: Mutex::new(Vec::new()),
            })
        }

        fn sent(&self) -> Vec<Uuid> {
            self.sent.lock().unwrap().clone()
        }
    }

    impl WithdrawalSender for FakeSender {
        fn chain(&self) -> Chain {
            self.chain
        }

        fn send<'a>(&'a self, withdrawal: &'a PendingWithdrawal) -> SendFuture<'a> {
            self.sent.lock().unwrap().push(withdrawal.id);
            let outcome = self.outcome.clone();
            Box::pin(async move { outcome })
        }
    }

    fn accepted() -> DispatchOutcome {
        DispatchOutcome::Accepted {
            tx_hash: "abc".to_owned(),
        }
    }

    fn account(seed: u8) -> String {
        stellar_strkey::ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    fn withdrawal(chain: Chain, money: Money) -> PendingWithdrawal {
        PendingWithdrawal {
            id: Uuid::new_v4(),
            chain,
            money,
            destination: account(2),
            memo: None,
        }
    }

    fn row(chain: &str, asset: &str, amount: &str) -> ClaimedRow {
        ClaimedRow {
            id: Uuid::new_v4(),
            chain: chain.to_owned(),
            asset: asset.to_owned(),
            amount: amount.to_owned(),
            destination: account(2),
            memo: None,
            created_at: chrono::Utc::now(),
        }
    }

    /// A pool that never connects; for tests that must not touch the database.
    fn lazy_pool() -> PgPool {
        sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://localhost/unused")
            .unwrap()
    }

    // ── Decoding ─────────────────────────────────────────────────────────

    #[test]
    fn decodes_a_stored_row_exactly() {
        let decoded = row("stellar", "USDC", "123456789012345678901234567")
            .decode()
            .unwrap();
        assert_eq!(decoded.chain, Chain::Stellar);
        assert_eq!(
            decoded.money,
            Money::from_minor(Asset::Usdc, 123_456_789_012_345_678_901_234_567)
        );
    }

    #[test]
    fn undecodable_rows_explain_why() {
        assert!(
            row("solana", "XLM", "1")
                .decode()
                .unwrap_err()
                .contains("chain")
        );
        assert!(
            row("stellar", "DOGE", "1")
                .decode()
                .unwrap_err()
                .contains("DOGE")
        );
        assert!(
            row("stellar", "XLM", "1.5")
                .decode()
                .unwrap_err()
                .contains("amount")
        );
        assert!(
            row("stellar", "XLM", "0")
                .decode()
                .unwrap_err()
                .contains("positive")
        );
        let too_big = "9".repeat(60);
        assert!(
            row("stellar", "XLM", &too_big)
                .decode()
                .unwrap_err()
                .contains("range")
        );
    }

    #[test]
    fn chain_keys_round_trip() {
        for chain in Chain::ALL {
            assert_eq!(parse_chain(chain_key(chain)), Some(chain));
        }
    }

    // ── Memos ────────────────────────────────────────────────────────────

    #[test]
    fn numeric_memos_become_id_memos() {
        assert_eq!(stellar_memo("99999"), StellarMemo::Id(99_999));
        assert_eq!(
            stellar_memo("18446744073709551615"),
            StellarMemo::Id(u64::MAX)
        );
    }

    #[test]
    fn other_memos_stay_text() {
        assert_eq!(
            stellar_memo("order-42"),
            StellarMemo::Text("order-42".to_owned())
        );
        // `u64::from_str` accepts a leading '+'; an exchange would not.
        assert_eq!(stellar_memo("+42"), StellarMemo::Text("+42".to_owned()));
        // Too large for an ID memo, so it is kept verbatim as text.
        assert_eq!(
            stellar_memo("18446744073709551616"),
            StellarMemo::Text("18446744073709551616".to_owned())
        );
    }

    // ── Dispatch ─────────────────────────────────────────────────────────

    #[tokio::test]
    async fn dispatch_routes_to_the_sender_for_the_chain() {
        let stellar = FakeSender::new(Chain::Stellar, accepted());
        let base = FakeSender::new(
            Chain::Base,
            DispatchOutcome::Rejected {
                reason: "no".to_owned(),
            },
        );
        let worker = WithdrawalWorker::new(lazy_pool())
            .with_sender(stellar.clone())
            .with_sender(base.clone());

        let xlm = withdrawal(Chain::Stellar, Money::from_minor(Asset::Xlm, 1));
        let eth = withdrawal(Chain::Base, Money::from_minor(Asset::Eth, 1));
        assert_eq!(worker.dispatch(&xlm).await, accepted());
        assert!(matches!(
            worker.dispatch(&eth).await,
            DispatchOutcome::Rejected { .. }
        ));
        assert_eq!(stellar.sent(), vec![xlm.id]);
        assert_eq!(base.sent(), vec![eth.id]);
    }

    #[tokio::test]
    async fn dispatch_without_a_sender_retries_instead_of_failing() {
        let worker = WithdrawalWorker::new(lazy_pool());
        let btc = withdrawal(Chain::Bitcoin, Money::from_minor(Asset::Btc, 1));
        assert!(matches!(
            worker.dispatch(&btc).await,
            DispatchOutcome::Retry { .. }
        ));
    }

    // ── Stellar sender ───────────────────────────────────────────────────

    fn testnet_signer() -> Arc<dyn StellarSigner> {
        Arc::new(
            LocalTestnetSigner::from_secret(
                stellar_strkey::ed25519::PrivateKey([4; 32])
                    .as_unredacted()
                    .to_string()
                    .as_str(),
                StellarNetwork::Testnet,
            )
            .unwrap(),
        )
    }

    fn stellar_sender(server: &MockServer) -> StellarWithdrawalSender {
        let config =
            StellarConfig::new(StellarNetwork::Testnet, Some(server.uri()), &account(1)).unwrap();
        StellarWithdrawalSender::new(StellarClient::new(config).unwrap(), testnet_signer())
    }

    async fn mount_account_and_fees(server: &MockServer) {
        Mock::given(method("GET"))
            .and(path(format!("/accounts/{}", testnet_signer().account())))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "sequence": "100" })),
            )
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path("/fee_stats"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "fee_charged": { "p50": "100", "p90": "100" }
            })))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn stellar_sender_reports_the_accepted_hash() {
        let server = MockServer::start().await;
        mount_account_and_fees(&server).await;
        // A Stellar transaction hash is 32 bytes, i.e. 64 hex characters.
        const TX_HASH: &str = "167ce3abe1973e68a5a4d1b64128e8d45f18740113eea89632470ca2aafb6c01";
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "hash": TX_HASH,
                "ledger": 7
            })))
            .mount(&server)
            .await;

        let w = withdrawal(Chain::Stellar, Money::from_minor(Asset::Xlm, 10_000_000));
        let outcome = stellar_sender(&server).send(&w).await;
        assert_eq!(
            outcome,
            DispatchOutcome::Accepted {
                tx_hash: TX_HASH.to_owned()
            }
        );
    }

    #[tokio::test]
    async fn stellar_sender_retries_when_horizon_is_down_before_submitting() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200))
            .expect(0)
            .mount(&server)
            .await;

        let w = withdrawal(Chain::Stellar, Money::from_minor(Asset::Xlm, 1));
        let outcome = stellar_sender(&server).send(&w).await;
        assert!(
            matches!(outcome, DispatchOutcome::Retry { .. }),
            "{outcome:?}"
        );
    }

    #[tokio::test]
    async fn stellar_sender_marks_network_rejections_as_rejected() {
        let server = MockServer::start().await;
        mount_account_and_fees(&server).await;
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
                "title": "Transaction Failed",
                "extras": { "result_codes": { "transaction": "tx_failed", "operations": ["op_underfunded"] } }
            })))
            .mount(&server)
            .await;

        let w = withdrawal(Chain::Stellar, Money::from_minor(Asset::Xlm, 1));
        let outcome = stellar_sender(&server).send(&w).await;
        let DispatchOutcome::Rejected { reason } = outcome else {
            panic!("expected Rejected, got {outcome:?}");
        };
        assert!(reason.contains("op_underfunded"));
    }

    #[tokio::test]
    async fn stellar_sender_flags_an_unreadable_submit_response_as_ambiguous() {
        let server = MockServer::start().await;
        mount_account_and_fees(&server).await;
        // 200 means Horizon took the transaction, but the body is garbage, so
        // we cannot tell what happened. It must not be retried.
        Mock::given(method("POST"))
            .and(path("/transactions"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not json"))
            .mount(&server)
            .await;

        let w = withdrawal(Chain::Stellar, Money::from_minor(Asset::Xlm, 1));
        let outcome = stellar_sender(&server).send(&w).await;
        let DispatchOutcome::Ambiguous { tx_hash, .. } = outcome else {
            panic!("expected Ambiguous, got {outcome:?}");
        };
        assert_eq!(tx_hash.map(|hash| hash.len()), Some(64));
    }

    #[tokio::test]
    async fn stellar_sender_refuses_assets_stellar_does_not_carry() {
        let server = MockServer::start().await;
        let w = withdrawal(Chain::Stellar, Money::from_minor(Asset::Btc, 1));
        let outcome = stellar_sender(&server).send(&w).await;
        assert!(matches!(outcome, DispatchOutcome::Rejected { .. }));
    }

    #[tokio::test]
    async fn stellar_sender_rejects_an_invalid_destination_without_submitting() {
        let server = MockServer::start().await;
        mount_account_and_fees(&server).await;
        let mut w = withdrawal(Chain::Stellar, Money::from_minor(Asset::Xlm, 1));
        w.destination = "not-an-address".to_owned();
        let outcome = stellar_sender(&server).send(&w).await;
        assert!(
            matches!(outcome, DispatchOutcome::Rejected { .. }),
            "{outcome:?}"
        );
    }

    // ── Integration tests (require a PostgreSQL database) ──────────────
    //
    // The database must already have backend/migrations applied, as
    // scripts/verify-migrations.sh does.
    // Run with: DATABASE_URL=postgres://… cargo test -p engipay-chain \
    //           workers::withdrawal -- --ignored

    async fn test_pool() -> Option<PgPool> {
        let url = std::env::var("DATABASE_URL").ok()?;
        let pool = PgPool::connect(&url).await.ok()?;
        // Each test assumes it owns the queue.
        sqlx::query("DELETE FROM withdrawals")
            .execute(&pool)
            .await
            .ok()?;
        Some(pool)
    }

    async fn insert(pool: &PgPool, chain: &str, status: &str) -> Uuid {
        let user = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(user)
            .execute(pool)
            .await
            .unwrap();
        let asset = if chain == "stellar" { "XLM" } else { "ETH" };
        sqlx::query_scalar(
            "INSERT INTO withdrawals
                 (user_id, chain, asset, amount, estimated_network_fee, destination, status, cooling_off_until)
             VALUES ($1, $2, $3, 10000000, 100, $4, $5,
                     CASE WHEN $5 = 'cooling_off' THEN now() + interval '1 hour' END)
             RETURNING id",
        )
        .bind(user)
        .bind(chain)
        .bind(asset)
        .bind(account(2))
        .bind(status)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn status(pool: &PgPool, id: Uuid) -> (String, Option<String>) {
        sqlx::query_as("SELECT status, tx_hash FROM withdrawals WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    // These share one table, so they run as a single test to stay isolated
    // from each other under cargo's parallel test runner.
    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn postgres_withdrawal_worker_claims_and_dispatches() {
        let pool = test_pool().await.unwrap();
        claim_marks_rows_broadcasting_and_skips_locked_rows(&pool).await;
        claim_only_takes_chains_with_a_sender(&pool).await;
        outcomes_move_rows_to_the_right_status(&pool).await;
        expired_cooling_off_is_released_and_sent_in_the_same_tick(&pool).await;
        concurrent_workers_never_send_a_withdrawal_twice(&pool).await;
    }

    async fn claim_marks_rows_broadcasting_and_skips_locked_rows(pool: &PgPool) {
        let locked = insert(pool, "stellar", "pending_broadcast").await;
        let free = insert(pool, "stellar", "pending_broadcast").await;

        // Another worker is mid-claim on `locked`.
        let mut other = pool.begin().await.unwrap();
        sqlx::query("SELECT id FROM withdrawals WHERE id = $1 FOR UPDATE")
            .bind(locked)
            .execute(&mut *other)
            .await
            .unwrap();

        let claimed = claim_batch(pool, &["stellar"], 10).await.unwrap();
        assert_eq!(
            claimed.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![free]
        );
        assert_eq!(status(pool, free).await.0, "broadcasting");
        assert_eq!(status(pool, locked).await.0, "pending_broadcast");

        // Already broadcasting, so a second claim does not take it again.
        other.rollback().await.unwrap();
        let claimed = claim_batch(pool, &["stellar"], 10).await.unwrap();
        assert_eq!(
            claimed.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![locked]
        );
        assert!(
            claim_batch(pool, &["stellar"], 10)
                .await
                .unwrap()
                .is_empty()
        );
        sqlx::query("DELETE FROM withdrawals")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn claim_only_takes_chains_with_a_sender(pool: &PgPool) {
        let base = insert(pool, "base", "pending_broadcast").await;
        let stellar = FakeSender::new(Chain::Stellar, accepted());
        let worker = WithdrawalWorker::new(pool.clone()).with_sender(stellar.clone());

        let report = worker.tick().await.unwrap();
        assert_eq!(report.dispatched(), 0);
        assert!(stellar.sent().is_empty());
        assert_eq!(status(pool, base).await.0, "pending_broadcast");
        sqlx::query("DELETE FROM withdrawals")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn outcomes_move_rows_to_the_right_status(pool: &PgPool) {
        let cases = [
            (accepted(), "broadcast_accepted", Some("abc")),
            (
                DispatchOutcome::Rejected {
                    reason: "op_underfunded".to_owned(),
                },
                "failed",
                None,
            ),
            (
                DispatchOutcome::Retry {
                    reason: "horizon down".to_owned(),
                },
                "pending_broadcast",
                None,
            ),
            (
                DispatchOutcome::Ambiguous {
                    tx_hash: Some("feed".to_owned()),
                    reason: "timeout".to_owned(),
                },
                "pending_manual_review",
                Some("feed"),
            ),
        ];
        for (outcome, expected_status, expected_hash) in cases {
            let id = insert(pool, "stellar", "pending_broadcast").await;
            let sender = FakeSender::new(Chain::Stellar, outcome.clone());
            let worker = WithdrawalWorker::new(pool.clone()).with_sender(sender.clone());

            let report = worker.tick().await.unwrap();
            assert_eq!(report.dispatched(), 1, "{outcome:?}");
            assert_eq!(sender.sent(), vec![id]);
            let (actual_status, actual_hash) = status(pool, id).await;
            assert_eq!(actual_status, expected_status, "{outcome:?}");
            assert_eq!(actual_hash.as_deref(), expected_hash, "{outcome:?}");
            sqlx::query("DELETE FROM withdrawals")
                .execute(pool)
                .await
                .unwrap();
        }
    }

    async fn expired_cooling_off_is_released_and_sent_in_the_same_tick(pool: &PgPool) {
        let expired = insert(pool, "stellar", "cooling_off").await;
        let still_cooling = insert(pool, "stellar", "cooling_off").await;
        sqlx::query(
            "UPDATE withdrawals SET cooling_off_until = now() - interval '1 second' WHERE id = $1",
        )
        .bind(expired)
        .execute(pool)
        .await
        .unwrap();

        let sender = FakeSender::new(Chain::Stellar, accepted());
        let worker = WithdrawalWorker::new(pool.clone()).with_sender(sender.clone());
        let report = worker.tick().await.unwrap();

        assert_eq!(report.requeued, 1);
        assert_eq!(sender.sent(), vec![expired]);
        assert_eq!(status(pool, expired).await.0, "broadcast_accepted");
        assert_eq!(status(pool, still_cooling).await.0, "cooling_off");
        sqlx::query("DELETE FROM withdrawals")
            .execute(pool)
            .await
            .unwrap();
    }

    async fn concurrent_workers_never_send_a_withdrawal_twice(pool: &PgPool) {
        let mut ids = Vec::new();
        for _ in 0..40 {
            ids.push(insert(pool, "stellar", "pending_broadcast").await);
        }
        let sender = FakeSender::new(Chain::Stellar, accepted());
        let workers: Vec<_> = (0..4)
            .map(|_| {
                Arc::new(
                    WithdrawalWorker::new(pool.clone())
                        .with_sender(sender.clone())
                        .with_batch_size(3),
                )
            })
            .collect();

        let handles: Vec<_> = workers
            .into_iter()
            .map(|worker| {
                tokio::spawn(async move { while worker.tick().await.unwrap().dispatched() > 0 {} })
            })
            .collect();
        for handle in handles {
            handle.await.unwrap();
        }

        let mut sent = sender.sent();
        sent.sort();
        ids.sort();
        assert_eq!(sent, ids, "every withdrawal sent exactly once");
        sqlx::query("DELETE FROM withdrawals")
            .execute(pool)
            .await
            .unwrap();
    }
}
