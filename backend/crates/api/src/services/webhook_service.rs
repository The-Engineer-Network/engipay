use chrono::Utc;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as b64_engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{errors::Error, AppState, Result};
use serde_json::Value;

type HmacSha256 = Hmac<Sha256>;

/// Represents a webhook subscription stored in the database.
#[derive(Debug, Clone, FromRow)]
pub struct WebhookSubscription {
    pub id: Uuid,
    pub merchant_id: Uuid,
    pub endpoint_url: String,
    pub events: Value,
    pub secret: String,
    pub is_active: bool,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Represents a webhook delivery attempt stored in the database.
#[derive(Debug, Clone, FromRow)]
pub struct WebhookDeliveryAttempt {
    pub id: Uuid,
    pub subscription_id: Uuid,
    pub event: String,
    pub payload: Value,
    pub status_code: Option<i32>,
    pub response_body: Option<Value>,
    pub signed_at: chrono::DateTime<chrono::Utc>,
    pub sent_at: Option<chrono::DateTime<chrono::Utc>>,
    pub retry_count: i32,
    pub last_error: Option<String>,
    pub delivered: bool,
}

/// Sign a webhook delivery using HMAC with the endpoint's secret and timestamp.
/// The signature includes the timestamp to protect against replay attacks.
fn sign_webhook(secret: &str, timestamp: i64, payload: &Value) -> String {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC key length is valid");
    mac.update(timestamp.to_string().as_bytes());
    mac.update(payload.to_string().as_bytes());
    let result = mac.finalize();
    let code_bytes = result.into_bytes();
    b64_engine.encode(code_bytes)
}

/// Verify the HMAC signature of an incoming webhook request.
/// Returns the timestamp if valid, or an error if verification fails.
pub fn verify_webhook_signature(
    secret: &str,
    timestamp: i64,
    signature: &str,
    payload: &Value,
) -> Result<i64> {
    let expected_sig = sign_webhook(secret, timestamp, payload);
    if expected_sig == signature {
        Ok(timestamp)
    } else {
        Err(Error::invalid_argument("Invalid webhook signature"))
    }
}

/// Exponential backoff delays in seconds: 1, 2, 4, 8, 16, 32
const BACKOFF_DELAYS: [i64; 6] = [1, 2, 4, 8, 16, 32];

/// Send a webhook delivery to a merchant endpoint with retries and exponential backoff.
/// Returns the final delivery attempt record.
pub async fn send_webhook(
    state: &AppState,
    subscription_id: Uuid,
    event: &str,
    payload: Value,
    max_retries: u32,
) -> Result<WebhookDeliveryAttempt> {
    // Get the webhook subscription
    let subscription = sqlx::query_as::<_, WebhookSubscription>(
        "SELECT * FROM merchant_webhook_subscriptions WHERE id = $1 AND is_active = true",
    )
    .bind(subscription_id)
    .fetch_optional(&state.database)
    .await?
    .ok_or_else(|| Error::not_found("Webhook subscription not found or inactive"))?;

    let secret = &subscription.secret;

    // Insert the initial delivery attempt
    let attempt_id = sqlx::query_as::<_, WebhookDeliveryAttempt>(
        "INSERT INTO merchant_webhook_delivery_attempts (
            id, subscription_id, event, payload, signed_at, retry_count, delivered
        ) VALUES (
            $1, $2, $3, $4, $5, 0, false
        ) RETURNING *",
    )
    .bind(Uuid::new_v4())
    .bind(subscription_id)
    .bind(event)
    .bind(payload)
    .bind(Utc::now())
    .fetch_one(&state.database)
    .await?;

    let mut current_attempt_id = attempt.id;

    for retry in 0..=max_retries {
        let timestamp = Utc::now().timestamp();
        let delivery_id = Uuid::new_v4().to_string();

        let delivery = serde_json::json!({
            "event": event,
            "payload": payload,
            "signed_at": Utc::now().to_rfc3339(),
            "delivery_id": delivery_id,
        });

        let signature = sign_webhook(secret, timestamp, &delivery);

        // Build the webhook request using reqwest
        let client = reqwest::Client::new();
        let url = &subscription.endpoint_url;

        let request_body = serde_json::to_string(&delivery).unwrap();

        let response = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-Webhook-Signature", &signature)
            .header("X-Webhook-Timestamp", timestamp.to_string())
            .body(request_body)
            .send()
            .await;

        match response {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let body_bytes = resp.bytes().await.unwrap_or_default();

                // Update the delivery attempt with response details
                let _ = sqlx::query(
                    "UPDATE merchant_webhook_delivery_attempts SET
                        retry_count = $1,
                        status_code = $2,
                        response_body = $3,
                        delivered = true,
                        sent_at = $4
                    WHERE id = $5",
                )
                .bind(retry as i32)
                .bind(status as i32)
                .bind(serde_json::Value::from(body_bytes))
                .bind(Utc::now())
                .bind(current_attempt_id)
                .execute(&state.database)
                .await?;

                // If status is 2xx, consider it successful and return
                if status >= 200 && status < 300 {
                    return Ok(attempt);
                }

                // Store error for non-2xx responses (continue to retry or stop)
                let _ = sqlx::query(
                    "UPDATE merchant_webhook_delivery_attempts SET
                        last_error = $1
                    WHERE id = $2",
                )
                .bind(String::from_utf8_lossy(&body_bytes).to_string())
                .bind(current_attempt_id)
                .execute(&state.database)
                .await?;

                // If this was the last retry, stop
                if retry >= max_retries {
                    break;
                }
            }
            Err(e) => {
                // Network error
                let _ = sqlx::query(
                    "UPDATE merchant_webhook_delivery_attempts SET
                        last_error = $1
                    WHERE id = $2",
                )
                .bind(e.to_string())
                .bind(current_attempt_id)
                .execute(&state.database)
                .await?;

                if retry >= max_retries {
                    break;
                }
            }
        }

        // Apply exponential backoff before retrying
        let backoff = BACKOFF_DELAYS[retry as usize % BACKOFF_DELAYS.len()];
        tokio::time::sleep(tokio::time::Duration::from_secs(backoff)).await;
    }

    // All retries exhausted - mark as failed in the database
    let _ = sqlx::query(
        "UPDATE merchant_webhook_delivery_attempts SET
            delivered = false,
            last_error = 'Max retries exceeded'
        WHERE id = $1",
    )
    .bind(current_attempt_id)
    .execute(&state.database)
    .await?;

    // Fetch the final state
    let final_attempt = sqlx::query_as::<_, WebhookDeliveryAttempt>(
        "SELECT * FROM merchant_webhook_delivery_attempts WHERE id = $1",
    )
    .bind(current_attempt_id)
    .fetch_one(&state.database)
    .await?;

    Ok(final_attempt)
}