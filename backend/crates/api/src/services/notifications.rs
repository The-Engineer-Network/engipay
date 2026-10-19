//! Writing entries to the in-app notification feed.
//!
//! [`record`] is the single entry point the rest of the backend uses to tell a
//! user about an event. It is idempotent: the caller supplies a `dedupe_key`
//! that identifies the event (for example `"deposit:<tx_hash>"`), and emitting
//! the same key again is a no-op. That makes it safe to call from a worker
//! that may crash and replay work.

use engipay_core::UserId;
use sqlx::PgPool;
use uuid::Uuid;

/// Longest allowed `kind`, `title`, `body` and `dedupe_key`. These mirror the
/// CHECK constraints in migration 0018 so bad input fails here with a clear
/// error instead of as a database error.
pub const MAX_KIND_LEN: usize = 64;
pub const MAX_TITLE_LEN: usize = 200;
pub const MAX_BODY_LEN: usize = 2000;
pub const MAX_DEDUPE_KEY_LEN: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewNotification {
    pub user: UserId,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub dedupe_key: String,
}

#[derive(Debug, thiserror::Error)]
pub enum NotificationError {
    #[error("{field} must be between 1 and {max} characters")]
    InvalidLength { field: &'static str, max: usize },
    #[error("notification database error: {0}")]
    Database(#[from] sqlx::Error),
}

impl NewNotification {
    /// Checks lengths before anything is written.
    pub fn validate(&self) -> Result<(), NotificationError> {
        check("kind", &self.kind, MAX_KIND_LEN, 1)?;
        check("title", &self.title, MAX_TITLE_LEN, 1)?;
        check("body", &self.body, MAX_BODY_LEN, 0)?;
        check("dedupe_key", &self.dedupe_key, MAX_DEDUPE_KEY_LEN, 1)?;
        Ok(())
    }
}

fn check(
    field: &'static str,
    value: &str,
    max: usize,
    min: usize,
) -> Result<(), NotificationError> {
    let len = value.chars().count();
    if len < min || len > max {
        return Err(NotificationError::InvalidLength { field, max });
    }
    Ok(())
}

/// Result of an emit: the new row's id, or `None` when this dedupe key was
/// already recorded for the user (nothing was written).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Recorded {
    pub id: Option<Uuid>,
}

/// Adds a notification for a user, at most once per `dedupe_key`.
pub async fn record(pool: &PgPool, new: &NewNotification) -> Result<Recorded, NotificationError> {
    new.validate()?;

    let id: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO notifications (user_id, kind, title, body, dedupe_key) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (user_id, dedupe_key) DO NOTHING \
         RETURNING id",
    )
    .bind(new.user.as_uuid())
    .bind(&new.kind)
    .bind(&new.title)
    .bind(&new.body)
    .bind(&new.dedupe_key)
    .fetch_optional(pool)
    .await?;

    Ok(Recorded { id })
}
