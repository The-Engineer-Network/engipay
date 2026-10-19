//! engipay-chain
//!
//!   engipay-chain                                   watch for deposits
//!   engipay-chain serve                            internal HTTP API
//!   engipay-chain stellar-send <to> <amount> <asset>  testnet payment
//!   engipay-chain withdrawals                       broadcast pending withdrawals (testnet signer)
//!   engipay-chain dlq list                         list pending uncredited deposits
//!   engipay-chain dlq reprocess <id>               reprocess one uncredited deposit
//!   engipay-chain dlq resolve <id> "<note>"        mark one uncredited deposit resolved
//!
//! Configuration comes from the environment; see backend/.env.example.

use std::env;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context};
use engipay_chain::deposit_creditor::DepositCreditor;
use engipay_chain::evm::{BaseClient, BaseNetwork, BASE_CHAIN_KEY};
use engipay_chain::routes;
use engipay_chain::routes::estimate_fee::FeeQuotes;
use engipay_chain::routes::router;
use engipay_chain::stellar::cursor::{CursorStore, STELLAR_CHAIN_KEY};
use engipay_chain::stellar::payment::{LocalTestnetSigner, PaymentRequest, StellarSigner};
use engipay_chain::stellar::{StellarClient, StellarConfig, StellarNetwork};
use engipay_chain::watch::{watch_chain, ChainWatch, CursorFormat};
use engipay_chain::workers::reconcile::{ReconcileWorker, DEFAULT_INTERVAL as RECONCILE_INTERVAL};
use engipay_chain::workers::withdrawal::{
    StellarWithdrawalSender, WithdrawalWorker, DEFAULT_POLL_INTERVAL,
};
use engipay_core::{Asset, Money};
use sqlx::postgres::PgPoolOptions;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        None => watch().await,
        Some("serve") => serve().await,
        Some("stellar-send") => stellar_send(&args[1..]).await,
        Some("withdrawals") => withdrawals().await,
        Some("dlq") => dlq_command(&args[1..]).await,
        Some(other) => bail!("unknown command {other:?}; see the top of crates/chain/src/main.rs"),
    }
}

/// Serves the internal HTTP API the api service calls.
///
/// Bound to loopback by default: nothing here is authenticated, so it must not
/// be reachable from outside the deployment. Stellar quotes come from network
/// constants; `BASE_RPC_URL` and `BITCOIN_ESPLORA_URL` turn on the live Base
/// and Bitcoin quotes, and a chain without an endpoint answers `503`.
async fn serve() -> anyhow::Result<()> {
    let address = env::var("CHAIN_HTTP_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8081".to_owned())
        .parse::<std::net::SocketAddr>()
        .context("CHAIN_HTTP_ADDR must be a host:port address, e.g. 127.0.0.1:8081")?;
    let fees = FeeQuotes::new(
        env::var("BASE_RPC_URL").ok(),
        env::var("BITCOIN_ESPLORA_URL").ok(),
    )
    .context("invalid fee source configuration")?;

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .with_context(|| format!("could not bind {address}"))?;
    info!(
        %address,
        base_rpc = env::var("BASE_RPC_URL").is_ok(),
        bitcoin_esplora = env::var("BITCOIN_ESPLORA_URL").is_ok(),
        "chain service internal API listening"
    );

    axum::serve(listener, router(Arc::new(fees)))
        .with_graceful_shutdown(async {
            if tokio::signal::ctrl_c().await.is_err() {
                warn!("could not listen for shutdown signal");
            }
        })
        .await
        .context("the internal API server stopped unexpectedly")?;
    Ok(())
}

fn stellar_client() -> anyhow::Result<Option<StellarClient>> {
    let Ok(custody) = env::var("STELLAR_CUSTODY_ACCOUNT") else {
        return Ok(None);
    };
    let network_name = env::var("STELLAR_NETWORK").unwrap_or_else(|_| "testnet".to_owned());
    let network = StellarNetwork::parse(&network_name).with_context(|| {
        format!("STELLAR_NETWORK must be testnet or mainnet, got {network_name:?}")
    })?;
    let config = StellarConfig::new(network, env::var("STELLAR_HORIZON_URL").ok(), &custody)?;
    Ok(Some(StellarClient::new(config)?))
}

/// Builds the Base deposit client from `BASE_RPC_URL`, `BASE_CUSTODY_ADDRESS`
/// and `BASE_NETWORK` when both are configured. `Ok(None)` means Base is not
/// configured and simply is not watched.
///
/// # Errors
/// Returns an error when only one of the two variables is set, or when the
/// network or address is invalid: a misconfigured Base watcher must fail loudly
/// at startup rather than silently stop crediting deposits.
fn base_client() -> anyhow::Result<Option<BaseClient>> {
    let network = nonempty_env("BASE_NETWORK").unwrap_or_else(|| "sepolia".to_owned());
    base_client_from(
        nonempty_env("BASE_RPC_URL"),
        nonempty_env("BASE_CUSTODY_ADDRESS"),
        &network,
    )
}

/// Reads a variable, treating an empty or whitespace-only value as unset so
/// `BASE_RPC_URL=` in a `.env` file does not count as configuration.
fn nonempty_env(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// The environment-free half of [`base_client`], kept separate so tests do not
/// touch process-wide environment variables.
fn base_client_from(
    rpc_url: Option<String>,
    custody_address: Option<String>,
    network: &str,
) -> anyhow::Result<Option<BaseClient>> {
    match (rpc_url, custody_address) {
        (None, None) => Ok(None),
        (Some(_), None) => bail!(
            "BASE_CUSTODY_ADDRESS is not configured; set it (or unset BASE_RPC_URL) to watch Base"
        ),
        (None, Some(_)) => bail!(
            "BASE_RPC_URL is not configured; set it (or unset BASE_CUSTODY_ADDRESS) to watch Base"
        ),
        (Some(rpc_url), Some(custody_address)) => {
            let network_name = network;
            let network = BaseNetwork::from_name(network_name).with_context(|| {
                format!("BASE_NETWORK must be mainnet or sepolia, got {network_name:?}")
            })?;
            Ok(Some(BaseClient::new(network, rpc_url, &[custody_address])?))
        }
    }
}

/// Builds a database pool from `DATABASE_URL` if it is set. Returns `None`
/// when no URL is configured so the watcher can operate without a database
/// during development and smoke tests.
async fn db_pool() -> anyhow::Result<Option<sqlx::PgPool>> {
    let Ok(url) = env::var("DATABASE_URL") else {
        return Ok(None);
    };
    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .context("could not connect to DATABASE_URL")?;
    Ok(Some(pool))
}

async fn watch() -> anyhow::Result<()> {
    // Always start the internal HTTP server so the API can reach fee estimates
    // even when no Stellar custody account is configured.
    let internal_addr =
        env::var("CHAIN_INTERNAL_ADDR").unwrap_or_else(|_| "127.0.0.1:8081".to_owned());
    let fees = routes::estimate_fee::FeeQuotes::new(
        env::var("BASE_RPC_URL").ok(),
        env::var("BITCOIN_ESPLORA_URL").ok(),
    )
    .map_err(|error| anyhow::anyhow!("could not configure the fee oracle: {error}"))?;
    let app = routes::router(Arc::new(fees));
    let listener = tokio::net::TcpListener::bind(&internal_addr)
        .await
        .with_context(|| format!("could not bind internal server to {internal_addr}"))?;
    info!(address = %internal_addr, "engipay-chain internal server listening");
    tokio::spawn(async move {
        if let Err(error) = axum::serve(listener, app).await {
            tracing::error!(%error, "internal HTTP server error");
        }
    });

    let stellar = stellar_client()?;
    let base = base_client()?;
    if stellar.is_none() && base.is_none() {
        info!(
            "no networks configured; set STELLAR_CUSTODY_ACCOUNT or BASE_RPC_URL + \
             BASE_CUSTODY_ADDRESS to watch deposits"
        );
        tokio::signal::ctrl_c().await?;
        return Ok(());
    }

    let pool = db_pool().await?;
    let cursor_store: Option<CursorStore> = pool.as_ref().map(|p| CursorStore::new(p.clone()));

    // Build the creditor when we have a database pool. Without a pool the
    // watcher falls back to logging-only mode (useful for smoke tests and
    // local development without Postgres).
    let creditor: Option<Arc<DepositCreditor>> = pool
        .as_ref()
        .map(|p| Arc::new(DepositCreditor::new(p.clone())));

    // One watch task per configured network. Each resumes from its own cursor
    // in `chain_cursors` (`stellar`, `base`), so a restart picks up exactly
    // where it left off. A task that stops (bad stored cursor, unreachable
    // endpoint at startup) is joined below and fails the process instead of
    // silently watching nothing.
    let shutdown = CancellationToken::new();
    let mut watching = tokio::task::JoinSet::new();

    if let Some(stellar) = stellar {
        let config = stellar.config();
        let cfg = ChainWatch {
            chain_key: STELLAR_CHAIN_KEY,
            network: format!("{:?}", config.network),
            custody: vec![config.custody_account.clone()],
            poll: Duration::from_secs(
                env::var("STELLAR_POLL_SECONDS")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(5),
            ),
            // Explicit override via STELLAR_START_LEDGER (useful for backfills);
            // otherwise the loop resumes from the stored cursor, or the tip.
            start_override: env::var("STELLAR_START_LEDGER")
                .ok()
                .map(|value| {
                    value
                        .parse()
                        .context("STELLAR_START_LEDGER must be a ledger number")
                })
                .transpose()?,
            format: CursorFormat::HorizonToid,
        };
        // Hoist the clones: an `async move` block captures the originals by value.
        let store = cursor_store.clone();
        let cred = creditor.clone();
        let token = shutdown.clone();
        watching.spawn(async move {
            (
                "stellar",
                watch_chain(Arc::new(stellar), cfg, store, cred, token).await,
            )
        });
    }

    if let Some(base) = base {
        let custody = base.deposit_addresses().iter().cloned().collect::<Vec<_>>();
        let cfg = ChainWatch {
            chain_key: BASE_CHAIN_KEY,
            network: format!("{:?}", base.network()),
            custody,
            poll: Duration::from_secs(
                env::var("BASE_POLL_SECONDS")
                    .ok()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(5),
            ),
            // Explicit override via BASE_START_BLOCK (useful for backfills);
            // otherwise the loop resumes from the stored cursor, or the tip.
            start_override: env::var("BASE_START_BLOCK")
                .ok()
                .map(|value| {
                    value
                        .parse()
                        .context("BASE_START_BLOCK must be a block number")
                })
                .transpose()?,
            format: CursorFormat::BlockNumber,
        };
        // Hoist the clones: an `async move` block captures the originals by value.
        let store = cursor_store.clone();
        let cred = creditor.clone();
        let token = shutdown.clone();
        watching.spawn(async move {
            (
                "base",
                watch_chain(Arc::new(base), cfg, store, cred, token).await,
            )
        });
    }

    // Spin up the daily reconciliation worker if we have a database pool.
    // It runs as a separate task so it never blocks the deposit watcher.
    let reconcile_shutdown = CancellationToken::new();
    if let Some(ref p) = pool {
        let reconcile_interval = env::var("RECONCILE_INTERVAL_SECONDS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(RECONCILE_INTERVAL);

        // Build a fresh StellarClient for the reconciler (StellarClient is not
        // Clone, and the deposit watcher needs its own to avoid shared state).
        if let Ok(Some(reconcile_stellar)) = stellar_client() {
            let worker = ReconcileWorker::new(p.clone(), reconcile_stellar);
            let token = reconcile_shutdown.clone();
            tokio::spawn(async move {
                worker.run(reconcile_interval, token).await;
            });
            info!(
                interval_secs = reconcile_interval.as_secs(),
                "reconciliation worker started"
            );
        }
    }

    // Wait for a shutdown signal. A watch task should never finish on its own:
    // if one does, the process must not keep running while that chain goes
    // unwatched. Every branch below ends the process, so no loop is needed.
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            info!("shutting down");
            shutdown.cancel();
            reconcile_shutdown.cancel();
            Ok(())
        }
        stopped = watching.join_next() => {
            let Some(stopped) = stopped else {
                // No watch tasks left: nothing is being watched any more.
                return Ok(());
            };
            let (chain, outcome) = stopped.context("a deposit watch task panicked")?;
            outcome.with_context(|| format!("the {chain} deposit watch loop stopped"))?;
            bail!("the {chain} deposit watch loop exited unexpectedly");
        }
    }
}

async fn stellar_send(args: &[String]) -> anyhow::Result<()> {
    let [destination, amount, asset] = args else {
        bail!("usage: engipay-chain stellar-send <destination> <amount> <XLM|USDC>");
    };
    let client = stellar_client()?
        .context("set STELLAR_CUSTODY_ACCOUNT (and STELLAR_NETWORK=testnet) first")?;
    let secret = env::var("STELLAR_TESTNET_SECRET")
        .context("set STELLAR_TESTNET_SECRET to the testnet account that pays")?;
    let signer = LocalTestnetSigner::from_secret(&secret, client.config().network)?;
    drop(secret);

    let asset: Asset = asset.parse()?;
    let request = PaymentRequest {
        destination: destination.clone(),
        money: Money::parse(asset, amount)?,
        memo: None,
    };
    info!(from = %signer.account(), to = %request.destination, amount = %request.money, "sending");
    let hash = client.send_payment(&signer, &request).await?;
    println!("{hash}");
    Ok(())
}

/// Broadcasts `pending_broadcast` withdrawals until interrupted. Signs with
/// `STELLAR_TESTNET_SECRET`, which [`LocalTestnetSigner`] refuses on mainnet.
async fn withdrawals() -> anyhow::Result<()> {
    let pool = db_pool()
        .await?
        .context("set DATABASE_URL to run the withdrawal worker")?;
    let client = stellar_client()?
        .context("set STELLAR_CUSTODY_ACCOUNT (and STELLAR_NETWORK=testnet) first")?;
    let secret = env::var("STELLAR_TESTNET_SECRET")
        .context("set STELLAR_TESTNET_SECRET to the testnet account that pays")?;
    let signer = LocalTestnetSigner::from_secret(&secret, client.config().network)?;
    drop(secret);
    info!(from = %signer.account(), "withdrawal worker starting");

    let worker = WithdrawalWorker::new(pool).with_sender(Arc::new(StellarWithdrawalSender::new(
        client,
        Arc::new(signer),
    )));
    let shutdown = CancellationToken::new();
    let on_signal = shutdown.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        on_signal.cancel();
    });
    worker.run(DEFAULT_POLL_INTERVAL, shutdown).await;
    Ok(())
}

/// Manages the Dead-Letter Queue (uncredited deposits).
///
///   engipay-chain dlq list                   List pending deposits
///   engipay-chain dlq reprocess <id>         Reprocess one deposit
///   engipay-chain dlq resolve <id> "<note>"  Mark one deposit resolved
async fn dlq_command(args: &[String]) -> anyhow::Result<()> {
    let pool = db_pool()
        .await?
        .context("set DATABASE_URL to manage the DLQ")?;

    match args.first().map(String::as_str) {
        Some("list") => dlq_list(&pool).await,
        Some("reprocess") => {
            let id = args
                .get(1)
                .context("usage: dlq reprocess <id>")?
                .parse()
                .context("id must be an integer")?;
            dlq_reprocess(&pool, id).await
        }
        Some("resolve") => {
            let id = args
                .get(1)
                .context("usage: dlq resolve <id> \"<note>\"")?
                .parse()
                .context("id must be an integer")?;
            let note = args.get(2).context("usage: dlq resolve <id> \"<note>\"")?;
            dlq_resolve(&pool, id, note).await
        }
        Some(other) => bail!("unknown dlq subcommand {other:?}; try list, reprocess, or resolve"),
        None => bail!("usage: dlq <list|reprocess|resolve>"),
    }
}

async fn dlq_list(pool: &sqlx::PgPool) -> anyhow::Result<()> {
    use engipay_chain::dlq_commands;

    let rows = dlq_commands::list(pool).await?;
    if rows.is_empty() {
        println!("No pending uncredited deposits.");
        return Ok(());
    }

    println!("Pending uncredited deposits ({} total):\n", rows.len());
    for row in &rows {
        println!("  ID:         {}", row.id);
        println!("  Created:    {}", row.created_at);
        println!("  Reason:     {}", row.reason);
        println!(
            "  Reference:  {}",
            row.raw_payload["reference"].as_str().unwrap_or("?")
        );
        println!(
            "  Address:    {}",
            row.raw_payload["address"].as_str().unwrap_or("?")
        );
        println!(
            "  Amount:     {} (minor units)",
            row.raw_payload["amount_minor"].as_i64().unwrap_or(0)
        );
        println!(
            "  Asset:      {}",
            row.raw_payload["asset"].as_str().unwrap_or("?")
        );
        println!();
    }
    Ok(())
}

async fn dlq_reprocess(pool: &sqlx::PgPool, id: i64) -> anyhow::Result<()> {
    use engipay_chain::deposit_creditor::DepositCreditor;
    use engipay_chain::dlq_commands;

    info!(id, "reprocessing uncredited deposit");
    let creditor = DepositCreditor::new(pool.clone());
    dlq_commands::reprocess(pool, id, &creditor).await?;
    println!("Uncredited deposit {id} reprocessed successfully.");
    Ok(())
}

async fn dlq_resolve(pool: &sqlx::PgPool, id: i64, note: &str) -> anyhow::Result<()> {
    use engipay_chain::dlq_commands;

    info!(id, note, "marking uncredited deposit as resolved");
    dlq_commands::resolve(pool, id, note).await?;
    println!("Uncredited deposit {id} marked as resolved.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use engipay_chain::ChainClient;
    use engipay_core::Chain;

    use super::*;

    const CUSTODY: &str = "0xAbC0000000000000000000000000000000000001";

    #[test]
    fn base_is_watched_when_rpc_and_custody_are_configured() {
        let client = base_client_from(
            Some("http://localhost:8545".to_owned()),
            Some(CUSTODY.to_owned()),
            "mainnet",
        )
        .expect("builds")
        .expect("a configured Base client is watched");
        assert_eq!(client.chain(), Chain::Base);
        assert_eq!(client.required_confirmations(), 12);
        assert_eq!(client.network(), BaseNetwork::Mainnet);
        assert_eq!(
            client.deposit_addresses().iter().next().map(String::as_str),
            Some("0xabc0000000000000000000000000000000000001")
        );
    }

    #[test]
    fn base_is_skipped_when_nothing_is_configured() {
        assert!(base_client_from(None, None, "sepolia")
            .expect("resolves")
            .is_none());
    }

    #[test]
    fn half_configured_base_is_refused() {
        assert!(
            base_client_from(Some("http://localhost:8545".to_owned()), None, "sepolia").is_err()
        );
        assert!(base_client_from(None, Some(CUSTODY.to_owned()), "sepolia").is_err());
    }

    #[test]
    fn an_unknown_base_network_is_refused() {
        let error = base_client_from(
            Some("http://localhost:8545".to_owned()),
            Some(CUSTODY.to_owned()),
            "goerli",
        )
        .expect_err("must refuse");
        assert!(
            error.to_string().contains("mainnet or sepolia"),
            "unexpected message: {error}"
        );
    }

    #[test]
    fn an_invalid_base_custody_address_is_refused() {
        let error = base_client_from(
            Some("http://localhost:8545".to_owned()),
            Some("not-an-address".to_owned()),
            "sepolia",
        )
        .expect_err("must refuse");
        assert!(
            error.to_string().contains("invalid deposit address"),
            "unexpected message: {error}"
        );
    }
}
