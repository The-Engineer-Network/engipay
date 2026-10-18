use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/healthz", get(health))
        .route("/live", get(liveness))
        .route("/ready", get(readiness))
}

#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
    database: &'static str,
    version: &'static str,
}

#[derive(Debug, Serialize)]
struct LivenessProbe {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct ReadinessProbe {
    status: &'static str,
    database: &'static str,
}

/// Liveness probe: indicates if the process is alive.
/// Returns 200 if the application is running, regardless of database status.
async fn liveness() -> (StatusCode, Json<LivenessProbe>) {
    (StatusCode::OK, Json(LivenessProbe { status: "alive" }))
}

/// Readiness probe: indicates if the application is ready to serve traffic.
/// Returns 200 only if the database is available and responding.
async fn readiness(State(state): State<AppState>) -> (StatusCode, Json<ReadinessProbe>) {
    let database = match &state.database {
        None => "not_configured",
        Some(pool) => match sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(pool)
            .await
        {
            Ok(_) => "ok",
            Err(_) => "unavailable",
        },
    };

    let status = if database == "ok" || database == "not_configured" {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        Json(ReadinessProbe {
            status: "ready",
            database,
        }),
    )
}

/// Combined health check (deprecated in favor of /live and /ready).
/// Kept for backward compatibility.
async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    let database = match &state.database {
        None => "not_configured",
        Some(pool) => match sqlx::query_scalar::<_, i32>("SELECT 1")
            .fetch_one(pool)
            .await
        {
            Ok(_) => "ok",
            Err(_) => "unavailable",
        },
    };

    let status = if database == "unavailable" {
        StatusCode::SERVICE_UNAVAILABLE
    } else {
        StatusCode::OK
    };
    let body = Health {
        status: if status == StatusCode::OK {
            "ok"
        } else {
            "degraded"
        },
        database,
        version: env!("CARGO_PKG_VERSION"),
    };
    (status, Json(body))
}
