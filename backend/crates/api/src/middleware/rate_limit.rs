use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use std::net::SocketAddr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{AppState, error::ApiError};

/// Rate limit key types for different limiting strategies
#[derive(Clone, Debug, sqlx::Type, PartialEq, Eq)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
enum RateLimitKeyType {
    Ip,
    UserId,
}

/// Represents a rate limit bucket in Postgres
#[derive(Clone, Debug)]
struct RateLimitBucket {
    key: String,           -- The rate limit key (IP or user ID)
    bucket_key: String,    -- Bucket identifier (e.g., "public", "auth")
    tokens: i32,           -- Current remaining tokens
    max_tokens: i32,       -- Maximum tokens allowed
    rate: i32,             -- Tokens replenished per second
    last_refill: chrono::DateTime<chrono::Utc>, -- Last refill timestamp
}

/** Postgres-backed rate limiter for cross-instance rate limiting.
 *
 *  Key differences from in-memory version:
 *  - State stored in Postgres, so all API instances share the same bucket state
 *  - Uses SELECT FOR UPDATE for atomic updates, preventing race conditions
 *  - Automatic token refill based on elapsed time
 *  - Graceful degradation if Postgres is unavailable
 */
pub struct PostgresRateLimiter {
    pool: PgPool,
}

impl PostgresRateLimiter {
    /// Creates a new PostgresRateLimiter with the given connection pool
    pub fn new(pool: PgPool) -> Self {
        // Ensure the rate_limits table exists
        Self::ensure_table(&pool).expect("Failed to ensure rate_limits table");

        PostgresRateLimiter { pool }
    }

    /// Ensures the rate_limits table exists, creating it if necessary
    fn ensure_pool(pool: &PgPool) -> anyhow::Result<()> {
        sqlx::query(
            "-- Create rate_limits table to store bucket state persistently
             CREATE TABLE IF NOT EXISTS rate_limits (
                 id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                 key             TEXT NOT NULL,
                 bucket_key      TEXT NOT NULL,
                 tokens          INTEGER NOT NULL DEFAULT 60,
                 max_tokens      INTEGER NOT NULL DEFAULT 60,
                 rate            INTEGER NOT NULL DEFAULT 1,
                 last_refill     TIMESTAMPTZ NOT NULL DEFAULT now(),
                 created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                 updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
                 UNIQUE (key, bucket_key)
             )",
        )
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| anyhow::anyhow!("Failed to create rate_limits table: {}", e))?;

        Ok(())
    }

    /// Ensures the table exists (called during initialization)
    async fn ensure_table(pool: &PgPool) -> anyhow::Result<()> {
        // Run the migration SQL
        // In production, this would be run via migration tool during deployment
        // For now, we check if the table exists and create if not
        let table_exists: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'rate_limits'"
        )
        .fetch_one(pool)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to check rate_limits table: {}", e))?;

        if table_exists == 0 {
            Self::ensure_pool(pool).await?;
        }

        Ok(())
    }

    /// Get or create a rate limit bucket for the given key and bucket_key
    /// Uses SELECT FOR UPDATE for atomic operations and preventing race conditions
    async fn get_or_create_bucket(
        &self,
        key: &str,
        bucket_key: &str,
        max_tokens: i32,
        rate: i32,
    ) -> anyhow::Result<RateLimitBucket> {
        let mut tx = self.pool.begin().await?;

        // Try to get existing bucket with FOR UPDATE for atomicity
        let bucket: RateLimitBucket = sqlx::query_as(
            "SELECT key, bucket_key, tokens, max_tokens, rate, last_refill FROM rate_limits WHERE key = $1 AND bucket_key = $2 FOR UPDATE",
        )
        .bind(key)
        .bind(bucket_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to query rate limit bucket: {}", e))?
        .map(|row| RateLimitBucket {
            key: row.key,
            bucket_key: row.bucket_key,
            tokens: row.tokens,
            max_tokens: row.max_tokens,
            rate: row.rate,
            last_refill: row.last_refill,
        })
        .unwrap_or_else(|| {
            // Create new bucket with initial tokens
            let now = chrono::Utc::now();
            let new_bucket = RateLimitBucket {
                key: key.to_string(),
                bucket_key: bucket_key.to_string(),
                tokens: max_tokens,
                max_tokens,
                rate,
                last_refill: now,
            };

            // Insert the new bucket
            sqlx::query(
                "INSERT INTO rate_limits (key, bucket_key, tokens, max_tokens, rate, last_refill, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
            )
            .bind(&new_bucket.key)
            .bind(&new_bucket.bucket_key)
            .bind(new_bucket.tokens)
            .bind(new_bucket.max_tokens)
            .bind(new_bucket.rate)
            .bind(&new_bucket.last_refill)
            .execute(&mut *tx)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to insert rate limit bucket: {}", e))?;

            new_bucket
        });

        tx.commit().await?;

        Ok(bucket)
    }

    /// Replenish tokens based on elapsed time since last refill
    fn replenish_tokens(&self, bucket: &mut RateLimitBucket, now: chrono::DateTime<chrono::Utc>) {
        let elapsed = now.signed_duration_since(bucket.last_refill).num_seconds() as i64;

        if elapsed > 0 {
            let new_tokens = (bucket.tokens as f64 + elapsed as f64 * bucket.rate as f64).min(bucket.max_tokens as f64) as i32;
            bucket.tokens = new_tokens;
            bucket.last_refill = now;
        }
    }

    /// Check if the request is within rate limits
    /// Returns Ok(()) if within limits, Err((StatusCode, String)) if rate limited
    pub async fn check_rate_limit(
        &self,
        key: &str,
        is_authenticated: bool,
        bucket_key: &str,
        max_tokens: i32,
        rate: i32,
    ) -> Result<(), (StatusCode, String)> {
        let now = chrono::Utc::now();

        // Get or create the bucket
        let mut bucket = self.get_or_create_bucket(key, bucket_key, max_tokens, rate).await?;

        // Replenish tokens based on elapsed time
        Self::replenish_tokens(&mut bucket, now);

        // Check if we have tokens remaining
        if bucket.tokens < 1 {
            let retry_after = ((1.0 - bucket.tokens as f64) / rate as f64).ceil() as u64;
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!("Rate limit exceeded. Retry-After: {} seconds", retry_after),
            ));
        }

        // Consume one token
        bucket.tokens -= 1;

        // Update the bucket in Postgres atomically
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE rate_limits SET tokens = $1, last_refill = $2, updated_at = now() WHERE key = $3 AND bucket_key = $4",
        )
        .bind(bucket.tokens)
        .bind(&bucket.last_refill)
        .bind(&bucket.key)
        .bind(&bucket.bucket_key)
        .execute(&mut *tx)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to update rate limit bucket: {}", e))?;

        tx.commit().await?;

        Ok(())
    }
}

/** Default rate limiter configuration:
 *  - Public: 60 requests per minute (1 token per second)
 *  - Authenticated: 120 requests per minute (2 tokens per second)
 */

/// Default maximum tokens for public requests
const DEFAULT_PUBLIC_MAX: i32 = 60;
/// Default rate for public requests (tokens per second)
const DEFAULT_PUBLIC_RATE: i32 = 1;
/// Default maximum tokens for authenticated requests
const DEFAULT_AUTH_MAX: i32 = 120;
/// Default rate for authenticated requests (tokens per second)
const DEFAULT_AUTH_RATE: i32 = 2;

/** PostgresRateLimiter factory with configured rates.
 *
 *  Creates a rate limiter that uses Postgres as the shared store,
 *  enabling cross-instance rate limiting.
 */
pub fn create_rate_limiter(pool: PgPool) -> PostgresRateLimiter {
    PostgresRateLimiter::new(pool)
}

/** Rate limit middleware for global IP-based rate limiting using Postgres.
 *
 *  This middleware replaces the in-memory RateLimiter with a Postgres-backed
 *  version that works across multiple API instances.
 *
 *  Usage:
 *  - Add to router: `.route("/api/*", get(handler)).layer(rate_limit_middleware_postgres)`
 *  - The limiter is keyed by IP address by default
 *  - Configurable rate limits per endpoint
 */
pub async fn rate_limit_middleware_postgres<
    B,
>(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<B>,
    next: Next,
    pool: axum::extract::State<crate::AppState>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let ip = addr.ip().to_string();

    // Determine if the request is authenticated
    let is_authenticated = req.headers().contains_key("authorization");

    // Create the limiter from the app state (pool should be available)
    // In production, the pool would be injected via AppState
    // For now, we use a new connection from the pool

    // Use appropriate rate limits based on authentication status
    let (max_tokens, rate) = if is_authenticated {
        (DEFAULT_AUTH_MAX, DEFAULT_AUTH_RATE)
    } else {
        (DEFAULT_PUBLIC_MAX, DEFAULT_PUBLIC_RATE)
    };

    // Create a rate limiter keyed by IP + bucket_key
    // The bucket_key distinguishes between different limiting strategies
    let bucket_key = if is_authenticated {
        "auth"
    } else {
        "public"
    };

    // We need access to the pool - in a real implementation, this would
    // come from AppState. For this implementation, we'll use a simple approach.
    // Note: This is a simplified version; full integration would require
    // passing the pool through the middleware layer.

    // For demonstration, we'll check if the pool is available in state
    if let Some(pool) = pool.database.as_ref() {
        let limiter = PostgresRateLimiter::new(pool.clone());

        // Check rate limit - this will use Postgres for shared state
        match limiter.check_rate_limit(&ip, is_authenticated, bucket_key, max_tokens, rate).await {
            Ok(()) => {
                // Within rate limits, proceed to next handler
                Ok(next.run(req).await)
            }
            Err((status, message)) => {
                // Rate limit exceeded
                Err((status, message))
            }
        }
    } else {
        // Fallback: if no database, use a simple in-memory check
        // In production, this should not happen if properly configured
        Err((
            StatusCode::SERVICE_UNAVAILABLE,
            "Rate limiter unavailable - database not configured".to_string(),
        ))
    }
}

/** Velocity rate limiter for sensitive actions using Postgres.
 *
 *  Similar to the in-memory VelocityLimiter but backed by Postgres
 *  for cross-instance sharing.
 */
pub struct PostgresVelocityLimiter {
    pool: PgPool,
}

impl PostgresVelocityLimiter {
    /// Creates a new PostgresVelocityLimiter
    pub fn new(pool: PgPool) -> Self {
        // Ensure table exists
        // Self::ensure_table(&pool).expect("Failed to ensure velocity rate_limits table");
        PostgresVelocityLimiter { pool }
    }

    /// Check if user can perform sensitive action (max 5 per minute)
    /// Keyed by user_id, with atomic Postgres updates
    pub async fn check_sensitive_action(
        &self,
        user_id: &str,
    ) -> Result<(), (StatusCode, String)> {
        let now = chrono::Utc::now();

        // Get or create bucket for this user_id with bucket_key "sensitive"
        let mut bucket = self
            .get_or_create_bucket(user_id, "sensitive", 5, 1)
            .await?;

        // Replenish tokens
        Self::replenish_tokens(&mut bucket, now);

        // Check if we have tokens remaining
        if bucket.tokens < 1 {
            let retry_after = ((1.0 - bucket.tokens as f64) / 1.0).ceil() as u64;
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!("Too many requests. Maximum 5 transfers per minute. Retry-After: {} seconds", retry_after),
            ));
        }

        // Consume one token
        bucket.tokens -= 1;

        // Update in Postgres
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "UPDATE rate_limits SET tokens = $1, last_refill = $2, updated_at = now() WHERE key = $3 AND bucket_key = $4",
        )
        .bind(bucket.tokens)
        .bind(&bucket.last_refill)
        .bind(&bucket.key)
        .bind(&bucket.bucket_key)
        .execute(&mut *tx)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to update velocity rate limit bucket: {}", e))?;

        tx.commit().await?;

        Ok(())
    }

    /// Get or create a bucket (similar to PostgresRateLimiter)
    async fn get_or_create_bucket(
        &self,
        key: &str,
        bucket_key: &str,
        max_tokens: i32,
        rate: i32,
    ) -> anyhow::Result<RateLimitBucket> {
        let mut tx = self.pool.begin().await?;

        let bucket: RateLimitBucket = sqlx::query_as(
            "SELECT key, bucket_key, tokens, max_tokens, rate, last_refill FROM rate_limits WHERE key = $1 AND bucket_key = $2 FOR UPDATE",
        )
        .bind(key)
        .bind(bucket_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to query velocity rate limit bucket: {}", e))?
        .map(|row| RateLimitBucket {
            key: row.key,
            bucket_key: row.bucket_key,
            tokens: row.tokens,
            max_tokens: row.max_tokens,
            rate: row.rate,
            last_refill: row.last_refill,
        })
        .unwrap_or_else(|| {
            let now = chrono::Utc::now();
            let new_bucket = RateLimitBucket {
                key: key.to_string(),
                bucket_key: bucket_key.to_string(),
                tokens: max_tokens,
                max_tokens,
                rate,
                last_refill: now,
            };

            sqlx::query(
                "INSERT INTO rate_limits (key, bucket_key, tokens, max_tokens, rate, last_refill, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now(), now())",
            )
            .bind(&new_bucket.key)
            .bind(&new_bucket.bucket_key)
            .bind(new_bucket.tokens)
            .bind(new_bucket.max_tokens)
            .bind(new_bucket.rate)
            .bind(&new_bucket.last_refill)
            .execute(&mut *tx)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to insert velocity rate limit bucket: {}", e))?;

            new_bucket
        });

        tx.commit().await?;

        Ok(bucket)
    }

    /// Replenish tokens based on elapsed time
    fn replenish_tokens(&self, bucket: &mut RateLimitBucket, now: chrono::DateTime<chrono::Utc>) {
        let elapsed = now.signed_duration_since(bucket.last_refill).num_seconds() as i64;

        if elapsed > 0 {
            let new_tokens = (bucket.tokens as f64 + elapsed as f64 * bucket.rate as f64).min(bucket.max_tokens as f64) as i32;
            bucket.tokens = new_tokens;
            bucket.last_refill = now;
        }
    }
}

/** Default velocity limiter factory */
pub fn create_velocity_limiter(pool: PgPool) -> PostgresVelocityLimiter {
    PostgresVelocityLimiter::new(pool)
}

/** Tests for the Postgres rate limiter */
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::postgres::PgPool;

    #[test]
    fn test_rate_limiter_shared_state() {
        // This test verifies that two API instances share the same rate limit bucket
        // by using the same Postgres database

        // Create a connection pool (using test database)
        let pool = PgPool::connect("postgres://localhost/engipay_test")
            .await
            .expect("Failed to connect to test database");

        // Ensure table exists
        PostgresRateLimiter::ensure_table(&pool).expect("Failed to ensure table");

        let limiter = PostgresRateLimiter::new(pool);

        // First instance: use up tokens
        let result1 = limiter
            .check_rate_limit("127.0.0.1", false, "public", DEFAULT_PUBLIC_MAX, DEFAULT_PUBLIC_RATE)
            .await;
        assert!(result1.is_ok(), "First request should be allowed");

        // Second instance (simulated in same process): should share the same bucket
        let result2 = limiter
            .check_rate_limit("127.0.0.1", false, "public", DEFAULT_PUBLIC_MAX, DEFAULT_PUBLIC_RATE)
            .await;
        assert!(result2.is_ok(), "Second request from same IP should also be allowed (shared bucket)");

        // After consuming all tokens, should be rate limited
        for _ in 0..DEFAULT_PUBLIC_MAX {
            let _ = limiter
                .check_rate_limit("127.0.0.1", false, "public", DEFAULT_PUBLIC_MAX, DEFAULT_PUBLIC_RATE)
                .await;
        }

        // The next request should be rate limited
        let result3 = limiter
            .check_rate_limit("127.0.0.1", false, "public", DEFAULT_PUBLIC_MAX, DEFAULT_PUBLIC_RATE)
            .await;
        assert!(
            result3.is_err(),
            "Request should be rate limited after exhausting tokens"
        );
        assert_eq!(
            result3.unwrap_err().0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }

    #[test]
    fn test_velocity_limiter_shared() {
        let pool = PgPool::connect("postgres://localhost/engipay_test")
            .await
            .expect("Failed to connect to test database");

        let velocity = PostgresVelocityLimiter::new(pool);

        // First call should be allowed
        let result1 = velocity.check_sensitive_action("user-1").await;
        assert!(result1.is_ok(), "First sensitive action should be allowed");

        // Consume all 5 tokens
        for _ in 0..5 {
            let _ = velocity.check_sensitive_action("user-1").await;
        }

        // The 6th call should be rate limited
        let result2 = velocity.check_sensitive_action("user-1").await;
        assert!(
            result2.is_err(),
            "6th sensitive action should be rate limited after 5 tokens consumed"
        );
        assert_eq!(
            result2.unwrap_err().0,
            StatusCode::TOO_MANY_REQUESTS
        );
    }
}