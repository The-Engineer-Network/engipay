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

    // Between 1 and 100, so `limit + 1` below cannot overflow.
    let limit: usize = params
        .limit
        .unwrap_or(20)
        .clamp(1, 100)
        .try_into()
        .unwrap_or(20);

    let cursor = params.cursor.as_deref().map(decode_cursor).transpose()?;

    // Filters are bound as parameters, never interpolated. Placeholders are
    // numbered in the order they are pushed, and bound in the same order.
    let mut sql = String::from(
        "SELECT id, direction, asset, crypto_amount::TEXT, created_at, status \
         FROM ramp_orders WHERE user_id = $1",
    );
    let mut placeholder = 1_usize;
    let mut next_placeholder = || {
        placeholder = placeholder.saturating_add(1);
        placeholder
    };

    if params.asset.is_some() {
        sql.push_str(&format!(" AND asset = ${}", next_placeholder()));
    }
    if params.r#type.is_some() {
        sql.push_str(&format!(" AND direction = ${}", next_placeholder()));
    }
    if cursor.is_some() {
        let created_at = next_placeholder();
        let id = next_placeholder();
        sql.push_str(&format!(
            " AND (created_at < ${created_at}::TIMESTAMPTZ \
             OR (created_at = ${created_at}::TIMESTAMPTZ AND id < ${id}::UUID))"
        ));
    }
    sql.push_str(&format!(
        " ORDER BY created_at DESC, id DESC LIMIT ${}",
        next_placeholder()
    ));

    type Row = (
        Uuid,
        String,
        String,
        String,
        sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>,
        String,
    );
    let mut query = sqlx::query_as::<_, Row>(&sql).bind(user_id.as_uuid());

    if let Some(asset) = params.asset {
        query = query.bind(asset);
    }
    if let Some(tx_type) = params.r#type {
        query = query.bind(tx_type);
    }
    if let Some((created_at, id)) = &cursor {
        query = query.bind(created_at).bind(id);
    }

    // One extra row tells us whether there is another page.
    let fetch = i64::try_from(limit.saturating_add(1)).unwrap_or(i64::MAX);
    query = query.bind(fetch);

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
            amount,
            direction: final_direction,
            timestamp: created_at.to_rfc3339(),
            counterparty: None,
        });
    }

    // Cursor pagination (#132)
    // The next page starts after the last row returned on this one.
    let has_more = transactions.len() > limit;
    transactions.truncate(limit);
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
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn a_cursor_round_trips() {
        let cursor = encode_cursor("2026-09-30T12:00:00+00:00", "8d1c4c8e");
        assert_eq!(
            decode_cursor(&cursor).unwrap(),
            (
                "2026-09-30T12:00:00+00:00".to_owned(),
                "8d1c4c8e".to_owned()
            )
        );
    }

    #[test]
    fn a_tampered_cursor_is_refused() {
        assert!(decode_cursor("not base64!").is_err());
        assert!(decode_cursor(&BASE64.encode("no-separator")).is_err());
    }
}
