use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Transaction {
    pub id: Uuid,
    pub kind: String,
    pub asset: String,
    pub amount: String,
    pub direction: String,
    pub timestamp: String,
    pub counterparty: Option<Counterparty>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Counterparty {
    pub tag: Option<String>,
    pub chain: Option<String>,
    pub address: Option<String>,
    pub tx_hash: Option<String>,
    pub timestamp: String,
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionsResponse {
    pub transactions: Vec<Transaction>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
pub struct TransactionsQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
    pub asset: Option<String>,
    pub r#type: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/transactions", get(get_transactions))
}

fn decode_cursor(cursor: &str) -> Result<(String, String), ApiError> {
    let decoded = BASE64
        .decode(cursor)
        .map_err(|_| ApiError::BadRequest("invalid cursor".to_string()))?;
    let decoded_str = String::from_utf8(decoded)
        .map_err(|_| ApiError::BadRequest("invalid cursor encoding".to_string()))?;

    let parts: Vec<&str> = decoded_str.split('|').collect();
    if parts.len() != 2 {
        return Err(ApiError::BadRequest("invalid cursor format".to_string()));
    }
    Ok((parts[0].to_string(), parts[1].to_string()))
}

fn encode_cursor(created_at: &str, tx_id: &str) -> String {
    let cursor_data = format!("{}|{}", created_at, tx_id);
    BASE64.encode(cursor_data)
}

/// Get unified transaction history with cursor pagination, filtering, and directional metadata
/// Get unified transaction history for the authenticated user (#131).
/// Returns a chronological feed of conversions and ramp orders.
async fn get_transactions(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<TransactionsQuery>,
) -> Result<Json<TransactionsResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let limit = params.limit.unwrap_or(20).min(100);

    let (cursor_created_at, cursor_tx_id) = if let Some(cursor) = params.cursor {
        decode_cursor(&cursor)?
    } else {
        (String::new(), String::new())
    };

    // Safe parameterized query with optional filters
    let query_base = "SELECT id, direction, asset, crypto_amount, created_at, status FROM ramp_orders WHERE user_id = $1";

    let mut query_with_filters = query_base.to_string();
    let mut param_count = 1;

    if params.asset.is_some() {
        param_count += 1;
        query_with_filters.push_str(&format!(" AND asset = ${}", param_count));
    }
    if params.r#type.is_some() {
        param_count += 1;
        query_with_filters.push_str(&format!(" AND direction = ${}", param_count));
    }

    if !cursor_created_at.is_empty() {
        param_count += 1;
        query_with_filters.push_str(&format!(
            " AND (created_at < ${}::TIMESTAMPTZ OR (created_at = ${}::TIMESTAMPTZ AND id < ${}::UUID))",
            param_count, param_count - 1, param_count + 1
        ));
        param_count += 1;
    }

    query_with_filters.push_str(&format!(" ORDER BY created_at DESC, id DESC LIMIT ${}", param_count + 1));

    // Build query with dynamic parameters
    let mut query = sqlx::query_as::<_, (Uuid, String, String, i64, sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>, String)>(
        &query_with_filters
    )
    .bind(user_id);

    if let Some(asset) = params.asset {
        query = query.bind(asset);
    }
    if let Some(tx_type) = params.r#type {
        query = query.bind(tx_type);
    }
    if !cursor_created_at.is_empty() {
        query = query.bind(&cursor_created_at).bind(&cursor_tx_id);
    }

    query = query.bind(limit + 1);

    let ramp_orders = query
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    // Build transaction list with directional metadata (#133)
    let mut transactions: Vec<Transaction> = Vec::new();

    for (id, direction, asset, amount, created_at, _status) in ramp_orders {
        let (final_direction, _counterparty) = match direction.as_str() {
            "on_ramp" => ("inflow".to_string(), None),
            "off_ramp" => ("outflow".to_string(), None),
            _ => (direction.clone(), None),
        };

        transactions.push(Transaction {
            id,
            kind: direction,
            asset,
            amount: amount.to_string(),
            direction: final_direction,
            timestamp: created_at.to_rfc3339(),
            counterparty: None,
        });
    }

    // Cursor pagination (#132)
    let has_more = transactions.len() > limit as usize;
    let cursor = if has_more {
        let last_tx = &transactions[limit as usize];
        Some(encode_cursor(&last_tx.timestamp, &last_tx.id.to_string()))
    } else {
        None
    };

    if has_more {
        transactions.pop();
    }

    Ok(Json(TransactionsResponse {
        transactions,
        cursor,
        has_more,
    // Query ramp orders
    let ramp_orders = sqlx::query!(
        r#"
        SELECT id, direction, asset, crypto_amount, created_at, status
        FROM ramp_orders
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
        user_id,
        limit
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    // Build transaction list
    let mut transactions: Vec<Transaction> = Vec::new();

    for order in ramp_orders {
        transactions.push(Transaction {
            id: order.id,
            kind: order.direction.unwrap_or_default(),
            asset: order.asset,
            amount: order.crypto_amount.unwrap_or_default().to_string(),
            timestamp: order.created_at.to_rfc3339(),
            description: order.status,
        });
    }

    Ok(Json(TransactionsResponse {
        transactions,
        cursor: None,
        has_more: false,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests skipped as per user request
}
