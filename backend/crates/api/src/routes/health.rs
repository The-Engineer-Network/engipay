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

    let status = if database == "ok" {
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

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;
    use crate::config::Config;
    use crate::middleware::rate_limit::RateLimiter;

    fn test_app() -> Router {
        let config = Config::for_tests();
        routes().with_state(AppState::with_fakes(None, config, RateLimiter::new()))
    }

    #[tokio::test]
    async fn liveness_returns_200_without_database() {
        let (status, Json(probe)) = liveness().await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(probe.status, "alive");
    }

    #[tokio::test]
    async fn readiness_returns_503_without_database() {
        let config = Config::for_tests();
        let state = AppState::with_fakes(None, config, RateLimiter::new());
        let (status, Json(probe)) = readiness(State(state)).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(probe.status, "ready");
        assert_eq!(probe.database, "not_configured");
    }

    #[tokio::test]
    async fn live_endpoint_returns_200_without_database() {
        let app = test_app();
        let response = app
            .oneshot(Request::builder().uri("/live").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["status"], "alive");
    }

    #[tokio::test]
    async fn ready_endpoint_returns_503_without_database() {
        let app = test_app();
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["status"], "ready");
        assert_eq!(body["database"], "not_configured");
    }
}
