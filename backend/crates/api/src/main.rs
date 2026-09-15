use anyhow::Context;
use engipay_api::{AppState, config::Config, router};
use sqlx::postgres::PgPoolOptions;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env().context("invalid configuration")?;
    init_tracing(&config);

    let database = match &config.database_url {
        Some(url) => {
            let pool = PgPoolOptions::new()
                .max_connections(config.db_max_connections)
                .acquire_timeout(std::time::Duration::from_secs(5))
                .connect(url)
                .await
                .context("could not connect to Postgres")?;
            sqlx::migrate!("../../migrations")
                .run(&pool)
                .await
                .context("database migrations failed")?;
            info!("database connected and migrations applied");
            Some(pool)
        }
        None => {
            warn!("DATABASE_URL is not set; running without a database");
            None
        }
    };

    let state = AppState { database };
    let app = router(state, &config);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("could not bind {}", config.bind_addr))?;
    info!(address = %config.bind_addr, "engipay api listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;
    Ok(())
}

fn init_tracing(config: &Config) {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    let builder = tracing_subscriber::fmt().with_env_filter(filter);
    if config.json_logs {
        builder.json().init();
    } else {
        builder.init();
    }
}

/// Finish in-flight requests on Ctrl+C or a container stop, rather than
/// cutting a money operation off halfway.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    info!("shutting down");
}
