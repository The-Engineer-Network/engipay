//! engipay-chain
//!
//!   engipay-chain                                   watch for deposits
//!   engipay-chain stellar-send <to> <amount> <asset>  testnet payment
//!
//! Configuration comes from the environment; see backend/.env.example.

use std::collections::{HashSet, VecDeque};
use std::env;
use std::time::Duration;

use anyhow::{Context, bail};
use engipay_chain::stellar::payment::{LocalTestnetSigner, PaymentRequest, StellarSigner};
use engipay_chain::stellar::{StellarClient, StellarConfig, StellarNetwork};
use engipay_chain::{ChainClient, is_creditable};
use engipay_core::stellar::{StellarAddress, parse_address};
use engipay_core::{Asset, Money};
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
        Some("stellar-send") => stellar_send(&args[1..]).await,
        Some(other) => bail!("unknown command {other:?}; see the top of crates/chain/src/main.rs"),
    }
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

async fn watch() -> anyhow::Result<()> {
    let Some(stellar) = stellar_client()? else {
        info!("no networks configured; set STELLAR_CUSTODY_ACCOUNT to watch Stellar deposits");
        tokio::signal::ctrl_c().await?;
        return Ok(());
    };
    let poll = Duration::from_secs(
        env::var("STELLAR_POLL_SECONDS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(5),
    );
    let mut next_ledger = match env::var("STELLAR_START_LEDGER") {
        Ok(value) => value
            .parse()
            .context("STELLAR_START_LEDGER must be a ledger number")?,
        Err(_) => stellar.latest_height().await?,
    };
    info!(
        network = ?stellar.config().network,
        custody = %stellar.config().custody_account,
        from_ledger = next_ledger,
        "watching stellar deposits"
    );

    let mut seen: HashSet<String> = HashSet::new();
    let mut seen_order: VecDeque<String> = VecDeque::new();
    let mut ticker = tokio::time::interval(poll);

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("shutting down");
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
            let user_deposit_id = match parse_address(&deposit.address) {
                Ok(StellarAddress::Muxed { id, .. }) => Some(id),
                _ => None,
            };
            match user_deposit_id {
                // Crediting the Postgres ledger lands with the ledger store;
                // until then the watcher reports what it would credit.
                Some(id) => info!(
                    deposit_id = id,
                    amount = %deposit.money,
                    reference = %deposit.reference,
                    "stellar deposit ready to credit"
                ),
                None => warn!(
                    amount = %deposit.money,
                    reference = %deposit.reference,
                    "stellar deposit to the bare custody account; needs manual review"
                ),
            }
            seen.insert(deposit.reference.clone());
            seen_order.push_back(deposit.reference);
            while seen_order.len() > SEEN_CAPACITY {
                if let Some(oldest) = seen_order.pop_front() {
                    seen.remove(&oldest);
                }
            }
        }
        next_ledger = tip;
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
    };
    info!(from = %signer.account(), to = %request.destination, amount = %request.money, "sending");
    let hash = client.send_payment(&signer, &request).await?;
    println!("{hash}");
    Ok(())
}
