pub mod assets;
pub mod health;
pub mod quotes;
pub mod settles;

use axum::Json;
use axum::routing::get;
use axum::Router;
use utoipa::OpenApi as _;

use crate::AppState;
use crate::ApiDoc;

/// Versioned routes. A breaking change becomes /v2 instead of surprising the app.
pub fn v1() -> Router<AppState> {
    Router::new()
        .merge(assets::routes())
        .merge(quotes::routes())
        .merge(settles::routes())
        .route("/openapi.json", get(openapi_spec))
}

/// Serve the generated OpenAPI 3.1 document.
///
/// The web app's `generate:sdk` script fetches this endpoint while the backend
/// is running and pipes it into `openapi-typescript` to produce
/// `lib/api-client.gen.ts`.  CI's `check:sdk` script does the same and diffs
/// against the committed file to fail on staleness.
async fn openapi_spec() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}
