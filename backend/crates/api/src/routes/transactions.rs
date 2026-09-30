use axum::extract::{Query, State};
use axum::routing::get;
use axum::{Json, Router};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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

    let limit = params.limit.unwrap_or(20).clamp(1, 100);
    let cursor = params.cursor.as_deref().map(decode_cursor).transpose()?;
    let cursor_time = cursor
        .as_ref()
        .map(|(time, _)| time.parse::<chrono::DateTime<chrono::Utc>>())
        .transpose()
        .map_err(|_| ApiError::BadRequest("invalid cursor timestamp".into()))?;
    let cursor_id = cursor
        .as_ref()
        .map(|(_, id)| id.parse::<Uuid>())
        .transpose()
        .map_err(|_| ApiError::BadRequest("invalid cursor id".into()))?;
    let query = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            String,
            chrono::DateTime<chrono::Utc>,
            String,
        ),
    >(
        "SELECT id, direction, asset, crypto_amount::text, created_at, status FROM ramp_orders
         WHERE user_id = $1 AND ($2::text IS NULL OR asset = $2)
         AND ($3::text IS NULL OR direction = $3)
         AND ($4::timestamptz IS NULL OR (created_at, id) < ($4, $5::uuid))
         ORDER BY created_at DESC, id DESC LIMIT $6",
    )
    .bind(user_id.as_uuid())
    .bind(params.asset)
    .bind(params.r#type)
    .bind(cursor_time)
    .bind(cursor_id)
    .bind(limit.saturating_add(1));

    let ramp_orders = query
        .fetch_all(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    // Build transaction list with directional metadata (#133)
    let mut transactions: Vec<Transaction> = Vec::new();

    for (id, direction, asset, amount, created_at, _status) in ramp_orders {
        let final_direction = match direction.as_str() {
            "on_ramp" => "inflow".to_string(),
            "off_ramp" => "outflow".to_string(),
            _ => direction.clone(),
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
    let page_size =
        usize::try_from(limit).map_err(|_| ApiError::BadRequest("invalid limit".into()))?;
    let has_more = transactions.len() > page_size;
    transactions.truncate(page_size);
    let cursor = if has_more {
        transactions
            .last()
            .map(|last| encode_cursor(&last.timestamp, &last.id.to_string()))
    } else {
        None
    };

    Ok(Json(TransactionsResponse {
        transactions,
        cursor,
        has_more,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cursor_round_trips_and_rejects_malformed_input() {
        let id = Uuid::new_v4().to_string();
        let time = "2026-09-30T00:00:00Z";
        assert_eq!(
            decode_cursor(&encode_cursor(time, &id)).expect("cursor"),
            (time.into(), id)
        );
        assert!(decode_cursor("invalid!").is_err());
        assert!(decode_cursor(&BASE64.encode("missing separator")).is_err());
    }
}
