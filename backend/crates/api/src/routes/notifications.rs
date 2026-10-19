//! The in-app notification feed.
//!
//! - `GET  /v1/notifications?limit=&before=` — newest first, keyset-paginated.
//!   `before` is the `id` of the last item from the previous page.
//! - `POST /v1/notifications/{id}/read` — mark one item read.
//! - `POST /v1/notifications/read-all` — mark every unread item read.
//!
//! Every query is scoped to the signed-in user. An id that belongs to someone
//! else is reported as not found, not forbidden, so ids cannot be probed.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

/// Items per page when `limit` is not given.
pub const DEFAULT_LIMIT: i64 = 20;
/// Largest page a client may ask for.
pub const MAX_LIMIT: i64 = 100;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list_notifications))
        .route("/notifications/read-all", post(mark_all_read))
        .route("/notifications/{id}/read", post(mark_read))
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    pub limit: Option<i64>,
    pub before: Option<Uuid>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NotificationItem {
    pub id: Uuid,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub read: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NotificationPage {
    pub items: Vec<NotificationItem>,
    /// Pass as `before` to fetch the next (older) page. `None` on the last page.
    pub next_before: Option<Uuid>,
    /// Unread items across the whole feed, not just this page.
    pub unread_count: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct MarkAllReadResponse {
    pub updated: u64,
}

/// Clamps a requested page size into `1..=MAX_LIMIT`.
pub fn page_size(requested: Option<i64>) -> Result<i64, ApiError> {
    match requested {
        None => Ok(DEFAULT_LIMIT),
        Some(n) if (1..=MAX_LIMIT).contains(&n) => Ok(n),
        Some(_) => Err(ApiError::BadRequest(format!(
            "limit must be between 1 and {MAX_LIMIT}"
        ))),
    }
}

fn format_time(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("notifications database error: {error}"))
}

async fn list_notifications(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListQuery>,
) -> Result<Json<NotificationPage>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;
    let limit = page_size(query.limit)?;

    // Keyset cursor: resume strictly after the anchor row in (created_at, id)
    // order. Using the id alone would skip or repeat rows that share a timestamp.
    let anchor: Option<(DateTime<Utc>, Uuid)> = match query.before {
        None => None,
        Some(before) => {
            let row = sqlx::query(
                "SELECT created_at, id FROM notifications WHERE id = $1 AND user_id = $2",
            )
            .bind(before)
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(db_error)?;
            match row {
                Some(row) => Some((
                    row.try_get("created_at").map_err(db_error)?,
                    row.try_get("id").map_err(db_error)?,
                )),
                None => {
                    return Err(ApiError::BadRequest(
                        "before does not refer to a notification in your feed".to_string(),
                    ));
                }
            }
        }
    };

    // Fetch one extra row to learn whether another page exists.
    let rows = sqlx::query(
        "SELECT id, kind, title, body, read_at, created_at \
         FROM notifications \
         WHERE user_id = $1 \
           AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3)) \
         ORDER BY created_at DESC, id DESC \
         LIMIT $4",
    )
    .bind(user_id)
    .bind(anchor.map(|(at, _)| at))
    .bind(anchor.map(|(_, id)| id))
    .bind(limit + 1)
    .fetch_all(db)
    .await
    .map_err(db_error)?;

    let has_more = rows.len() as i64 > limit;
    let mut items = Vec::with_capacity(limit as usize);
    for row in rows.iter().take(limit as usize) {
        let read_at: Option<DateTime<Utc>> = row.try_get("read_at").map_err(db_error)?;
        let created_at: DateTime<Utc> = row.try_get("created_at").map_err(db_error)?;
        items.push(NotificationItem {
            id: row.try_get("id").map_err(db_error)?,
            kind: row.try_get("kind").map_err(db_error)?,
            title: row.try_get("title").map_err(db_error)?,
            body: row.try_get("body").map_err(db_error)?,
            read: read_at.is_some(),
            created_at: format_time(created_at),
        });
    }

    let next_before = if has_more {
        items.last().map(|item| item.id)
    } else {
        None
    };

    let unread_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(db)
    .await
    .map_err(db_error)?;

    Ok(Json(NotificationPage {
        items,
        next_before,
        unread_count,
    }))
}

async fn mark_read(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // COALESCE keeps the first read time if the item is marked again.
    let result = sqlx::query(
        "UPDATE notifications SET read_at = COALESCE(read_at, now()) \
         WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .execute(db)
    .await
    .map_err(db_error)?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn mark_all_read(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<MarkAllReadResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let result = sqlx::query(
        "UPDATE notifications SET read_at = now() \
         WHERE user_id = $1 AND read_at IS NULL",
    )
    .bind(user_id)
    .execute(db)
    .await
    .map_err(db_error)?;

    Ok(Json(MarkAllReadResponse {
        updated: result.rows_affected(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_size_defaults_and_clamps() {
        assert_eq!(page_size(None).unwrap(), DEFAULT_LIMIT);
        assert_eq!(page_size(Some(1)).unwrap(), 1);
        assert_eq!(page_size(Some(MAX_LIMIT)).unwrap(), MAX_LIMIT);
    }

    #[test]
    fn page_size_rejects_zero_negative_and_oversized() {
        assert!(page_size(Some(0)).is_err());
        assert!(page_size(Some(-5)).is_err());
        assert!(page_size(Some(MAX_LIMIT + 1)).is_err());
    }
}
