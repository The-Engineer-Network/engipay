//! Cursor pagination helpers for `GET /v1/payment-requests`.
//!
//! The cursor is the base64 of `<created_at rfc3339>|<id>` of the last row of
//! the current page, matching the keyset ordering `(created_at DESC, id DESC)`.

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};
use sqlx::types::chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::ApiError;
use crate::routes::payment_requests::PaymentRequestSummary;

pub const DEFAULT_LIMIT: i64 = 20;
pub const MAX_LIMIT: i64 = 100;

#[derive(Debug, Deserialize)]
pub struct ListPaymentRequestsQuery {
    pub limit: Option<i64>,
    pub cursor: Option<String>,
}

/// Paginated body of `GET /v1/payment-requests`.
#[derive(Debug, Serialize, Deserialize)]
pub struct PaymentRequestsPage {
    pub requests: Vec<PaymentRequestSummary>,
    pub cursor: Option<String>,
    pub has_more: bool,
}

/// Clamp the requested limit to `1..=MAX_LIMIT`, defaulting to `DEFAULT_LIMIT`.
pub fn effective_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}

pub fn encode_cursor(created_at: &str, id: &str) -> String {
    BASE64.encode(format!("{created_at}|{id}"))
}

pub fn decode_cursor(cursor: &str) -> Result<(DateTime<Utc>, Uuid), ApiError> {
    let bad = |m: &str| ApiError::BadRequest(m.to_string());
    let bytes = BASE64.decode(cursor).map_err(|_| bad("invalid cursor"))?;
    let text = String::from_utf8(bytes).map_err(|_| bad("invalid cursor encoding"))?;
    let (ts, id) = text.split_once('|').ok_or_else(|| bad("invalid cursor format"))?;
    let ts = DateTime::parse_from_rfc3339(ts)
        .map_err(|_| bad("invalid cursor format"))?
        .with_timezone(&Utc);
    let id = Uuid::parse_str(id).map_err(|_| bad("invalid cursor format"))?;
    Ok((ts, id))
}

/// Trim the `limit + 1` fetched rows to a page and compute the next cursor.
pub fn build_page(mut rows: Vec<PaymentRequestSummary>, limit: i64) -> PaymentRequestsPage {
    let has_more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let cursor = if has_more {
        rows.last().map(|r| encode_cursor(&r.created_at, &r.id))
    } else {
        None
    };
    PaymentRequestsPage { requests: rows, cursor, has_more }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(n: u32) -> PaymentRequestSummary {
        PaymentRequestSummary {
            id: Uuid::from_u128(n as u128).to_string(),
            requested_amount: "100".into(),
            asset: "USDC".into(),
            status: "pending".into(),
            expires_at: "2030-01-01T00:00:00+00:00".into(),
            settled_at: None,
            allow_partial: false,
            amount_paid: "0".into(),
            amount_remaining: "100".into(),
            created_at: format!("2026-01-01T00:00:{n:02}+00:00"),
        }
    }

    #[test]
    fn limit_defaults_and_clamps() {
        assert_eq!(effective_limit(None), 20);
        assert_eq!(effective_limit(Some(500)), 100);
        assert_eq!(effective_limit(Some(0)), 1);
        assert_eq!(effective_limit(Some(5)), 5);
    }

    #[test]
    fn cursor_round_trips() {
        let r = row(7);
        let c = encode_cursor(&r.created_at, &r.id);
        let (ts, id) = decode_cursor(&c).unwrap();
        assert_eq!(ts.to_rfc3339(), r.created_at);
        assert_eq!(id.to_string(), r.id);
    }

    #[test]
    fn bad_cursors_are_rejected() {
        assert!(decode_cursor("not base64!!").is_err());
        assert!(decode_cursor(&BASE64.encode("nopipe")).is_err());
        assert!(decode_cursor(&BASE64.encode("nope|nope")).is_err());
    }

    #[test]
    fn page_with_extra_row_sets_cursor_to_last_kept_row() {
        let page = build_page(vec![row(3), row(2), row(1)], 2);
        assert!(page.has_more);
        assert_eq!(page.requests.len(), 2);
        let (_, id) = decode_cursor(page.cursor.as_deref().unwrap()).unwrap();
        assert_eq!(id.to_string(), page.requests[1].id);
    }

    #[test]
    fn last_page_has_no_cursor() {
        let page = build_page(vec![row(2), row(1)], 2);
        assert!(!page.has_more);
        assert!(page.cursor.is_none());
    }
}
