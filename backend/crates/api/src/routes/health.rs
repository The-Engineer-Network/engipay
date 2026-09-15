use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Serialize;

use crate::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/healthz", get(health))
}

#[derive(Debug, Serialize)]
struct Health {
    status: &'static str,
    database: &'static str,
    version: &'static str,
}

/// Liveness plus a real database round-trip, so a load balancer stops sending
/// traffic to an instance that has lost its database.
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
