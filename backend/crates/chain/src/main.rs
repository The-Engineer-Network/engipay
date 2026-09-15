use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Deliberately loads no keys yet. Signing arrives with the Base and
    // Bitcoin clients, backed by a KMS rather than a key file on disk.
    info!("engipay chain service started (no networks enabled, no signing keys loaded)");

    tokio::signal::ctrl_c().await?;
    info!("shutting down");
    Ok(())
}
