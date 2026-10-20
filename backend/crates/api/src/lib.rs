//! EngiPay HTTP API.
//!
//! Routes live here rather than in `main.rs` so tests can drive the real router
//! without opening a socket.

pub mod config;
pub mod error;
mod routes;

use axum::Router;
use axum::http::{HeaderValue, Method, header};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use utoipa::OpenApi;

use crate::config::Config;
use crate::routes::assets::{AssetInfo, NetworkInfo};
use crate::routes::quotes::{QuoteRequest, QuoteResponse};
use crate::routes::settles::{SettleRequest, SettleResponse};

#[derive(Clone)]
pub struct AppState {
    /// `None` only in local development without Postgres. Endpoints that need
    /// the database return 503 rather than pretending to work.
    pub database: Option<PgPool>,
}

/// The complete OpenAPI 3.1 document for the EngiPay API.
#[derive(OpenApi)]
#[openapi(
    info(
        title = "EngiPay API",
        version = "0.1.0",
        description = "Pay and get paid in crypto from Nigeria. Naira ramps, transfers, conversions."
    ),
    paths(
        routes::assets::list_assets,
        routes::quotes::create_quote,
        routes::settles::settle_hold,
    ),
    components(schemas(
        AssetInfo,
        NetworkInfo,
        QuoteRequest,
        QuoteResponse,
        SettleRequest,
        SettleResponse,
        engipay_core::Asset,
        engipay_core::Chain,
        engipay_core::Product,
    )),
    tags(
        (name = "assets", description = "Supported assets and networks"),
        (name = "fees",   description = "Fee quotes and settlement"),
    )
)]
pub struct ApiDoc;

pub fn router(state: AppState, config: &Config) -> Router {
    Router::new()
        .merge(routes::health::routes())
        .nest("/v1", routes::v1())
        .layer(cors(config))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Only the configured web origins may call the API from a browser.
fn cors(config: &Config) -> CorsLayer {
    let origins: Vec<HeaderValue> = config
        .allowed_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
}
