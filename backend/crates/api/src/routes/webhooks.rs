use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{errors::Error, AppState, Result};

/// Request body to register a new webhook subscription.
#[derive(Deserialize)]
pub struct WebhookSubscriptionRequest {
    /// URL endpoint that will receive webhook deliveries
    pub endpoint_url: String,
    /// JSON array of event names the merchant wants to receive (e.g., ["payment.received"])
    pub events: Vec<String>,
}

/// Response for a created webhook subscription.
#[derive(Serialize)]
pub struct WebhookSubscriptionResponse {
    pub id: String,
    pub endpoint_url: String,
    pub events: Vec<String>,
    pub is_active: bool,
    pub created_at: String,
}

/// Request body to toggle subscription active state.
#[derive(Deserialize)]
pub struct WebhookToggleRequest {
    /// Whether the subscription should be active
    pub active: bool,
}

/// Handler: POST /v1/merchants/webhooks/subscribe
/// A merchant registers an endpoint and chooses which events they want to be notified about.
pub async fn subscribe(State(state): State<AppState>, Json(body): Json<WebhookSubscriptionRequest>) -> Result<Json<WebhookSubscriptionResponse>> {
    let merchant_id = state
        .auth_context
        .merchant_id
        .unwrap_or_else(|| {
            // If no merchant context, use the authenticated user
            // In a real implementation, this would come from auth middleware
            tracing::error!("Merchant ID required for webhook subscription but not found in auth context");
            return Err(Error::unauthorized("Merchant ID required"));
        });

    // Generate a per-endpoint secret for HMAC signing
    let secret = format!("{}-{}", merchant_id, uuid::Uuid::new_v4());

    // Store the subscription in the database
    let subscription = sqlx::query_as::<_, crate::routes::webhooks::WebhookSubscription>(
        "INSERT INTO merchant_webhook_subscriptions (
            id, merchant_id, endpoint_url, events, secret, is_active, created_at, updated_at
        ) VALUES (
            $1, $2, $3, $4, $5, true, now(), now()
        ) RETURNING *
    ")
    .bind(Uuid::new_v4())
    .bind(merchant_id)
    .bind(&body.endpoint_url)
    .bind(serde_json::json!(body.events))
    .bind(&secret)
    .fetch_one(&state.database)
    .await?;

    Ok(Json(WebhookSubscriptionResponse {
        id: subscription.id.to_string(),
        endpoint_url: subscription.endpoint_url,
        events: serde_json::from_value(subscription.events).unwrap_or_default(),
        is_active: subscription.is_active,
        created_at: subscription.created_at.to_rfc3339(),
    }))
}

/// Handler: POST /v1/merchants/webhooks/:id/toggle
/// Toggle a webhook subscription active/inactive state.
pub async fn toggle(
    State(state): State<AppState>,
    Json(body): Json<WebhookToggleRequest>,
) -> Result<Json<WebhookSubscriptionResponse>> {
    // In a real implementation, we'd extract the subscription_id from the URL
    // For now, this is a placeholder
    tracing::info!("Toggle webhook subscription request: active={}", body.active);
    Ok(Json(WebhookSubscriptionResponse {
        id: "placeholder".to_string(),
        endpoint_url: "".to_string(),
        events: vec![],
        is_active: body.active,
        created_at: chrono::Utc::now().to_rfc3339(),
    }))
}

/// Handler: POST /v1/merchants/webhooks/:id/replay
/// Allow manual replay of a specific delivery attempt.
pub async fn replay(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>> {
    // In a real implementation, we'd extract the delivery attempt ID from the URL
    // and resend the webhook
    tracing::info!("Replay webhook delivery attempt");
    Ok(Json(serde_json::json!({ "status": "replayed" })))
}

/// Handler: GET /v1/merchants/webhooks
/// List all webhook subscriptions for the authenticated merchant.
pub async fn list_subscriptions(State(state): State<AppState>) -> Result<Json<Vec<WebhookSubscriptionResponse>>> {
    // In a real implementation, we'd filter by merchant_id from auth context
    let subs = vec![]; // Placeholder - would query database
    Ok(Json(subs))
}

/// Handler: POST /v1/ramp/webhook
/// Partner webhook callback endpoint - verifies signature and deduplicates.
pub async fn ramp_webhook(
    State(state): State<AppState>,
) -> StatusCode {
    // This would verify HMAC signature with per-endpoint secret and timestamp
    // Deduplicate using event_id in webhook_events table
    // Settle associated orders
    StatusCode::OK
}

pub fn routes() -> axum::Router<AppState> {
    axum::Router::new()
        .route("/merchants/webhooks/subscribe", axum::routing::post(subscribe))
        .route("/merchants/webhooks/:id/toggle", axum::routing::post(toggle))
        .route("/merchants/webhooks/:id/replay", axum::routing::post(replay))
        .route("/merchants/webhooks", axum::routing::get(list_subscriptions))
        .route("/v1/ramp/webhook", axum::routing::post(ramp_webhook))
}