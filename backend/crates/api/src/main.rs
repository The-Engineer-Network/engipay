use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use engipay_api::middleware::rate_limit::RateLimiter;
use engipay_api::services::destination_screen::StaticBlockList;
use engipay_api::{AppState, config::Config, router};
use sqlx::postgres::PgPoolOptions;
use tracing::{info, warn};

#[derive(Debug)]
enum Command {
    Serve,
    Freeze {
        user_id: uuid::Uuid,
        reason: String,
    },
    Unfreeze {
        user_id: uuid::Uuid,
    },
}

fn parse_args() -> anyhow::Result<Command> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("freeze") => {
            let user_id_str = args
                .next()
                .context("freeze requires <user-id> argument")?;
            let user_id = uuid::Uuid::parse_str(&user_id_str)
                .context("user-id must be a valid UUID")?;
            
            // Look for --reason flag
            let mut reason = None;
            while let Some(arg) = args.next() {
                if arg == "--reason" {
                    reason = Some(args.next().context("--reason requires a value")?);
                    break;
                }
            }
            let reason = reason.context("freeze requires --reason <text>")?;
            
            Ok(Command::Freeze { user_id, reason })
        }
        Some("unfreeze") => {
            let user_id_str = args
                .next()
                .context("unfreeze requires <user-id> argument")?;
            let user_id = uuid::Uuid::parse_str(&user_id_str)
                .context("user-id must be a valid UUID")?;
            Ok(Command::Unfreeze { user_id })
        }
        Some(other) => anyhow::bail!("unknown command: {other}"),
        None => Ok(Command::Serve),
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env().context("invalid configuration")?;
    init_tracing(&config);

    let command = parse_args()?;

    match command {
        Command::Serve => run_server(config).await,
        Command::Freeze { user_id, reason } => freeze_account(user_id, reason).await,
        Command::Unfreeze { user_id } => unfreeze_account(user_id).await,
    }
}

async fn freeze_account(user_id: uuid::Uuid, reason: String) -> anyhow::Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must be set for freeze command")?;
    let pool = sqlx::PgPool::connect(&database_url).await?;
    
    let actor = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());

    // Check if user exists
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(user_id)
        .fetch_one(&pool)
        .await?;
    
    if !exists {
        anyhow::bail!("user {user_id} does not exist");
    }

    // Freeze the account
    sqlx::query(
        "UPDATE user_profiles 
         SET frozen = true, frozen_reason = $2, frozen_by = NULL 
         WHERE user_id = $1"
    )
    .bind(user_id)
    .bind(&reason)
    .execute(&pool)
    .await?;

    // Record in audit log
    sqlx::query(
        "INSERT INTO freeze_audit (user_id, action, reason, actor) 
         VALUES ($1, 'freeze', $2, $3)"
    )
    .bind(user_id)
    .bind(&reason)
    .bind(&actor)
    .execute(&pool)
    .await?;

    info!(user_id = %user_id, actor = %actor, reason = %reason, "account frozen");
    println!("Account {user_id} frozen by {actor}: {reason}");
    Ok(())
}

async fn unfreeze_account(user_id: uuid::Uuid) -> anyhow::Result<()> {
    let database_url = std::env::var("DATABASE_URL")
        .context("DATABASE_URL must be set for unfreeze command")?;
    let pool = sqlx::PgPool::connect(&database_url).await?;
    
    let actor = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".to_string());

    // Check if user exists
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)")
        .bind(user_id)
        .fetch_one(&pool)
        .await?;
    
    if !exists {
        anyhow::bail!("user {user_id} does not exist");
    }

    // Unfreeze the account
    sqlx::query(
        "UPDATE user_profiles 
         SET frozen = false, frozen_reason = NULL, frozen_by = NULL 
         WHERE user_id = $1"
    )
    .bind(user_id)
    .execute(&pool)
    .await?;

    // Record in audit log
    sqlx::query(
        "INSERT INTO freeze_audit (user_id, action, reason, actor) 
         VALUES ($1, 'unfreeze', NULL, $2)"
    )
    .bind(user_id)
    .bind(&actor)
    .execute(&pool)
    .await?;

    info!(user_id = %user_id, actor = %actor, "account unfrozen");
    println!("Account {user_id} unfrozen by {actor}");
    Ok(())
}

async fn run_server(config: Config) -> anyhow::Result<()> {
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

    let replica_database = match std::env::var("REPLICA_DATABASE_URL") {
        Ok(url) if !url.is_empty() => {
            let pool = PgPoolOptions::new()
                .max_connections(config.db_max_connections)
                .acquire_timeout(std::time::Duration::from_secs(5))
                .connect(&url)
                .await
                .context("could not connect to replica Postgres")?;
            info!("replica database connected");
            Some(pool)
        }
        _ => {
            warn!("REPLICA_DATABASE_URL is not set; balance reads will use the primary database");
            None
        }
    };

    let mut state = AppState::with_fakes(database, config.clone(), RateLimiter::new());
    state.replica_database = replica_database;

    if config.production_mode && !state.fake_provider_names.is_empty() {
        let fakes = state.fake_provider_names.join(", ");
        anyhow::bail!(
            "refusing to start in production mode with fake providers: {fakes}. \
             Configure real provider credentials or unset ENGIPAY_ENV=production."
        );
    }

    // Load withdrawal destination block list from BLOCK_LIST_PATH if set.
    if let Ok(path) = std::env::var("BLOCK_LIST_PATH") {
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("could not read BLOCK_LIST_PATH={path:?}"))?;
        let entries: Vec<&str> = content
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .collect();
        let count = entries.len();
        state.destination_screen = Arc::new(StaticBlockList::new(entries));
        info!(count, path = %path, "withdrawal destination block list loaded");
    }

    let app = router(state, &config);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr)
        .await
        .with_context(|| format!("could not bind {}", config.bind_addr))?;
    info!(address = %config.bind_addr, "engipay api listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
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
