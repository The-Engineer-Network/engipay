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

use std::collections::{HashSet, VecDeque};
use std::env;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, bail};
use engipay_chain::deposit_creditor::DepositCreditor;
use engipay_chain::routes;
use engipay_chain::routes::estimate_fee::FeeQuotes;
use engipay_chain::routes::router;
use engipay_chain::stellar::cursor::{CursorStore, STELLAR_CHAIN_KEY, cursor_to_ledger};
use engipay_chain::stellar::horizon::cursor_for_ledger;
use engipay_chain::stellar::payment::{LocalTestnetSigner, PaymentRequest, StellarSigner};
use engipay_chain::stellar::{StellarClient, StellarConfig, StellarNetwork};
use engipay_chain::workers::reconcile::{ReconcileWorker, DEFAULT_INTERVAL as RECONCILE_INTERVAL};
use engipay_chain::workers::withdrawal::{
    DEFAULT_POLL_INTERVAL, StellarWithdrawalSender, WithdrawalWorker,
};
use engipay_chain::{ChainClient, is_creditable};
use engipay_core::{Asset, Money};
use sqlx::postgres::PgPoolOptions;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

/// References remembered to avoid reporting a deposit twice when polls overlap.
const SEEN_CAPACITY: usize = 10_000;

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

    let Some(stellar) = stellar_client()? else {
        info!("no networks configured; set STELLAR_CUSTODY_ACCOUNT to watch Stellar deposits");
        tokio::signal::ctrl_c().await?;
        return Ok(());
    };

    let pool = db_pool().await?;
    let cursor_store: Option<CursorStore> = pool.as_ref().map(|p| CursorStore::new(p.clone()));

    // Build the creditor when we have a database pool. Without a pool the
    // watcher falls back to logging-only mode (useful for smoke tests and
    // local development without Postgres).
    let creditor: Option<Arc<DepositCreditor>> = pool
        .as_ref()
        .map(|p| Arc::new(DepositCreditor::new(p.clone())));

    let poll = Duration::from_secs(
        env::var("STELLAR_POLL_SECONDS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(5),
    );

    // Determine the starting ledger:
    // 1. Explicit override via STELLAR_START_LEDGER (useful for backfills).
    // 2. Persisted cursor from the database (normal restart path).
    // 3. Current ledger tip (first-ever run with no database).
    let mut next_ledger: u64 = if let Ok(value) = env::var("STELLAR_START_LEDGER") {
        value
            .parse()
            .context("STELLAR_START_LEDGER must be a ledger number")?
    } else if let Some(store) = &cursor_store {
        match store.load(STELLAR_CHAIN_KEY).await? {
            Some(saved_cursor) => {
                // The saved cursor is a TOID; recover the ledger by shifting
                // the top 32 bits back out. This is a conservative estimate —
                // we will re-process the same ledger rather than miss it.
                //
                // If the cursor is unparsable or corrupt, refuse to start.
                // Falling back to ledger 0 would replay the entire chain and
                // cause duplicate credits.
                cursor_to_ledger(&saved_cursor).with_context(|| {
                    format!(
                        "stored cursor {saved_cursor:?} is invalid; fix or delete the chain_cursors row"
                    )
                })?
            }
            None => stellar.latest_height().await?,
        }
    } else {
        stellar.latest_height().await?
    };

    info!(
        network = ?stellar.config().network,
        custody = %stellar.config().custody_account,
        from_ledger = next_ledger,
        db_cursor = cursor_store.is_some(),
        creditor_enabled = creditor.is_some(),
        "watching stellar deposits"
    );

    let mut seen: HashSet<String> = HashSet::new();
    let mut seen_order: VecDeque<String> = VecDeque::new();
    let mut ticker = tokio::time::interval(poll);

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

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("shutting down");
                reconcile_shutdown.cancel();
                return Ok(());
            }
            _ = ticker.tick() => {}
        }

        // Read the tip first, then everything from the last tip onwards. Polls
        // overlap by one ledger on purpose; `seen` drops the repeats.
        let tip = match stellar.latest_height().await {
            Ok(tip) => tip,
            Err(error) => {
                warn!(%error, "horizon unavailable; retrying");
                continue;
            }
        };
        let deposits = match stellar.deposits_since(next_ledger).await {
            Ok(deposits) => deposits,
            Err(error) => {
                warn!(%error, "could not read deposits; retrying");
                continue;
            }
        };

        for deposit in deposits {
            if !is_creditable(&stellar, &deposit) || seen.contains(&deposit.reference) {
                continue;
            }

            // Deduplicate before calling the creditor so the in-memory `seen`
            // set short-circuits the overlap-by-one without a database round-trip.
            seen.insert(deposit.reference.clone());
            seen_order.push_back(deposit.reference.clone());
            while seen_order.len() > SEEN_CAPACITY {
                if let Some(oldest) = seen_order.pop_front() {
                    seen.remove(&oldest);
                }
            }

            match &creditor {
                Some(c) => {
                    // Credit the ledger. The creditor handles DLQ routing for
                    // unresolvable addresses and ledger errors; it never panics
                    // or returns an error that would crash this loop.
                    c.process(deposit).await;
                }
                None => {
                    // No database: log what would have been credited.
                    info!(
                        amount    = %deposit.money,
                        reference = %deposit.reference,
                        address   = %deposit.address,
                        "stellar deposit creditable (no database configured — not credited)"
                    );
                }
            }
        }

        // Advance cursor. Persist it atomically so a restart resumes here.
        next_ledger = tip;
        if let Some(store) = &cursor_store {
            let cursor_value = cursor_for_ledger(tip)
                .map(|c| c.to_string())
                .unwrap_or_else(|| tip.to_string());
            if let Err(error) = store.save(STELLAR_CHAIN_KEY, &cursor_value).await {
                warn!(%error, "could not persist cursor; will retry next poll");
            }
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
        println!("  Reference:  {}", row.raw_payload["reference"].as_str().unwrap_or("?"));
        println!("  Address:    {}", row.raw_payload["address"].as_str().unwrap_or("?"));
        println!("  Amount:     {} (minor units)", row.raw_payload["amount_minor"].as_i64().unwrap_or(0));
        println!("  Asset:      {}", row.raw_payload["asset"].as_str().unwrap_or("?"));
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
