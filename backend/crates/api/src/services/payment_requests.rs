use sqlx::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::error::ApiError;

/// Settlement service for payment requests (#130).
/// When a transfer references a payment_request_id, mark it as settled.
pub async fn settle_payment_request(
    pool: &PgPool,
    payment_request_id: Uuid,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'paid', settled_at = now()
        WHERE id = $1 AND status = 'pending'
        "#,
    )
    .bind(payment_request_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(())
}

/// Expiry verification service for background cleanup task (#129).
/// Mark all stale (expired) payment requests as expired.
pub async fn mark_stale_requests_expired(pool: &PgPool) -> Result<u64, ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE status = 'pending' AND expires_at < now()
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(result.rows_affected())
}

/// Verify that expired requests cannot be settled.
/// Returns true if request is still settleable (not expired or already paid).
pub async fn is_settleable(pool: &PgPool, payment_request_id: Uuid) -> Result<bool, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT status, expires_at FROM payment_requests
        WHERE id = $1
        "#,
    )
    .bind(payment_request_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    match row {
        Some(row) => {
            let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> = row
                .try_get("expires_at")
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            let is_expired = expires_at < sqlx::types::chrono::Utc::now();
            let is_pending: bool = row
                .try_get::<String, _>("status")
                .map(|status| status == "pending")
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            Ok(is_pending && !is_expired)
        }
        None => Ok(false),
    }
}

// ── Unit tests (#645) ─────────────────────────────────────────────────────────
//
// Every function here is a single SQL statement, so the tests run against a
// real Postgres. They are ignored by default; run them with:
//   DATABASE_URL=postgres://... cargo test -p engipay-api --lib services::payment_requests -- --ignored
//
// Other tests share the database, so each test asserts only on the rows it
// created.

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use sqlx::postgres::PgPoolOptions;

    async fn pool() -> PgPool {
        let url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .unwrap()
    }

    /// Inserts a payment request with `status`, expiring `expires_in` from now
    /// (a Postgres interval such as '1 hour' or '-1 second').
    async fn insert_request(pool: &PgPool, status: &str, expires_in: &str) -> Uuid {
        let user_id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(user_id)
            .execute(pool)
            .await
            .unwrap();
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO payment_requests
                 (id, user_id, recipient_id, asset, amount, requested_amount, uri, status, expires_at)
             VALUES ($1, $2, $2, 'USDC', 1000000, 1000000, 'engipay:test', $3, now() + $4::interval)",
        )
        .bind(id)
        .bind(user_id)
        .bind(status)
        .bind(expires_in)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn status_of(pool: &PgPool, id: Uuid) -> (String, bool) {
        let row = sqlx::query(
            "SELECT status, settled_at IS NOT NULL AS settled FROM payment_requests WHERE id = $1",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
        (row.get("status"), row.get("settled"))
    }

    // ── settle_payment_request ────────────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_marks_a_pending_request_paid() {
        let pool = pool().await;
        let id = insert_request(&pool, "pending", "1 hour").await;

        settle_payment_request(&pool, id).await.unwrap();

        assert_eq!(status_of(&pool, id).await, ("paid".to_owned(), true));
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_twice_is_a_no_op_the_second_time() {
        let pool = pool().await;
        let id = insert_request(&pool, "pending", "1 hour").await;
        settle_payment_request(&pool, id).await.unwrap();
        let first: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT settled_at FROM payment_requests WHERE id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();

        settle_payment_request(&pool, id).await.unwrap();

        let second: Option<chrono::DateTime<chrono::Utc>> =
            sqlx::query_scalar("SELECT settled_at FROM payment_requests WHERE id = $1")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(first, second, "settled_at must not move on a repeat");
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_leaves_a_non_pending_request_alone() {
        let pool = pool().await;
        let expired = insert_request(&pool, "expired", "-1 hour").await;
        let partial = insert_request(&pool, "partially_paid", "1 hour").await;

        settle_payment_request(&pool, expired).await.unwrap();
        settle_payment_request(&pool, partial).await.unwrap();

        assert_eq!(status_of(&pool, expired).await, ("expired".to_owned(), false));
        assert_eq!(
            status_of(&pool, partial).await,
            ("partially_paid".to_owned(), false)
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn settle_an_unknown_request_succeeds_without_effect() {
        let pool = pool().await;
        settle_payment_request(&pool, Uuid::new_v4()).await.unwrap();
    }

    // ── mark_stale_requests_expired ───────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn mark_stale_expires_only_pending_requests_past_their_expiry() {
        let pool = pool().await;
        let stale = insert_request(&pool, "pending", "-1 second").await;
        let live = insert_request(&pool, "pending", "1 hour").await;
        let paid_and_past = insert_request(&pool, "paid", "-1 hour").await;

        let affected = mark_stale_requests_expired(&pool).await.unwrap();

        // Other tests may leave stale rows too, so this is a lower bound.
        assert!(affected >= 1, "at least our stale request is expired");
        assert_eq!(status_of(&pool, stale).await.0, "expired");
        assert_eq!(status_of(&pool, live).await.0, "pending");
        assert_eq!(status_of(&pool, paid_and_past).await.0, "paid");
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn mark_stale_does_not_touch_an_already_expired_request() {
        let pool = pool().await;
        let id = insert_request(&pool, "pending", "-1 second").await;
        mark_stale_requests_expired(&pool).await.unwrap();

        mark_stale_requests_expired(&pool).await.unwrap();

        assert_eq!(status_of(&pool, id).await, ("expired".to_owned(), false));
    }

    // ── is_settleable ─────────────────────────────────────────────────────────

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_live_pending_request_is_settleable() {
        let pool = pool().await;
        let id = insert_request(&pool, "pending", "1 hour").await;
        assert!(is_settleable(&pool, id).await.unwrap());
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_pending_request_past_its_expiry_is_not_settleable() {
        // Not yet swept to 'expired': the expiry alone must be enough.
        let pool = pool().await;
        let id = insert_request(&pool, "pending", "-1 second").await;
        assert!(!is_settleable(&pool, id).await.unwrap());
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_paid_or_expired_request_is_not_settleable() {
        let pool = pool().await;
        let paid = insert_request(&pool, "paid", "1 hour").await;
        let expired = insert_request(&pool, "expired", "1 hour").await;
        let partial = insert_request(&pool, "partially_paid", "1 hour").await;
        assert!(!is_settleable(&pool, paid).await.unwrap());
        assert!(!is_settleable(&pool, expired).await.unwrap());
        assert!(!is_settleable(&pool, partial).await.unwrap());
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn an_unknown_request_is_not_settleable() {
        let pool = pool().await;
        assert!(!is_settleable(&pool, Uuid::new_v4()).await.unwrap());
    }
}
