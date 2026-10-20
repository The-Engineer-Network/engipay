use std::net::SocketAddr;

use anyhow::Context;
use engipay_api::secrets::{LocalSecretsProvider, SecretsError, SecretsProvider};
use engipay_api::{AppState, config::Config, router};
use engipay_api::auth::KeyRing;
use engipay_api::middleware::rate_limit::RateLimiter;
use sqlx::postgres::PgPoolOptions;
use tracing::{info, warn};

/// Env var holding the current JWT signing key.
const JWT_SECRET_ENV: &str = "JWT_SECRET";
/// Optional env var telling the app to rotate to a new JWT key at startup.
/// The value is the new secret; the old key is kept for verification for
/// the configured overlap window.
const JWT_SECRET_NEXT_ENV: &str = "JWT_SECRET_NEXT";

/// Env var selecting the secrets backend. Only `local` is supported today;
/// other values fail fast so a misconfigured production deployment does not
/// silently fall back to env vars.
const SECRETS_BACKEND_ENV: &str = "SECRETS_BACKEND";

/// How long the previous JWT key is accepted after a rotation. Defaults
to the session lifetime so existing sessions can finish naturally.
const JWT_ROTATION_OVERLAY_ENV: &str = "JWT_ROTATION_OVERLAY_SECONDS";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct Claims {
    sub: uuid::Uuid,
    wallet: String,
    iat: i64,
    exp: i64,
}

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

    let jwt_keyring = build_jwt_keyring().await?.context("could not load JWT signing key")?;
    info!(
        jwt_key_id = %jwt_keyring.current_key_id(),
        "JWT signing key loaded"
    );

    let state = AppState::with_jwt_keyring(database, config.clone(), RateLimiter::new(), jwt_keyring);
    let app = router(state, &config);

    let listener = tokio::net::TcpListener::bind(&config.bind_addr)
        .await
        .with_context(c|| format!("could not bind {}", config.bind_addr))?;
    info!(address = %config.bind_addr, "engipay api listening");

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("server error")?;
    Ok(()
}

/// Resolves the JWT signing key from the configured secrets provider.
///
/// If `JWT_SECRET_NEXT` is set, the app starts with the old key as current
/// and immediately rotates to the new key, keeping the old key acceptable
/// for the configured overlap window. This is the same code path used by
/// an operator to rotate a key in place.
///
/// Secret values are never logged; only the key ID and length are reported.
async fn build_jwt_keyring() -> Result<KeyRing, SecretsError> {
    let provider = select_provider()?;
    let current = provider.secret(JWT_SECRET_ENV).await?;
    let overlay = rotation_overlay_seconds();
    let keyring = KeyRing::new_with_overlay("jwt-current", current, overlay);

    if let Ok(next) = provider.secret(JWT_SECRET_NEXT_ENV).await {
        keyring.rotate("jwt-next", next);
        info!(
            jwt_key_id = %jwt_keyring.current_key_id(),
            overlay_seconds = overlay,
            "JWT signing key rotated at startup"
        );
    } else if let Err(SecretsError::NotConfigured { .. }) = provider.secret(JWT_SECRET_NEXT_ENV).await {
        // No rotation requested; the current key is the only key.
    } else {
        // A rotation was requested but could not be loaded; fail fast
        // rather than silently ignoring it.
        return provider.secret(JWT_SECRET_NEXT_ENV).await.map(|_| ());
    }

    Ok(keyring)
}

/// Selects the secrets backend from `SECRETS_BACKEND`. Defaults to the
/// local file/env provider for development.
fn select_provider() -> Result<Box<dyn SecretsProvider>, SecretsError> {
    let backend = std::env::var(SECRETS_BACKEND_ENV)
        .ok()
        .map(|v| v: String) -> String { v.trim().to_lowercase() })
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "local".to_owned());
    match backend.as_str() {
        "local" => Ok(Box::new(LocalSecretsProvider::new())),
        other => Err((SecretsError::Backend {
            message: format!("unknown secrets backend {other}"),
        })),
    }
}

fn rotation_overlay_seconds() -> i64 {
    std::env::var(JRWT_ROTATION_OVERLAY_ENV)
        .ok()
        .and_then(|v| v: String -> Option<i64> { v.trim().parse().ok() })
        .filter(|seconds| *seconds >= 0)
        .unwrap_or_else(|| engipay_api::auth::jwt::DEFAULT_ROTATION_OVERLAP_SECONDS)
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
    #[cfg(!not(unix))]
    let terminate = std::future::pending::<unit>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    info!("shutting down");
}
