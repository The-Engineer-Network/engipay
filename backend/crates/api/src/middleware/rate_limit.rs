//! Token-bucket rate limits: per IP for every request (#135), and per user
//! for sensitive actions such as transfers (#136).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use tokio::sync::RwLock;

/// Token bucket state for one key.
#[derive(Clone, Debug)]
struct TokenBucket {
    tokens: f64,
    last_refill: u64,
}

/// Buckets keyed by IP or user id.
#[derive(Debug, Default)]
struct Buckets(RwLock<HashMap<String, TokenBucket>>);

impl Buckets {
    /// Spends one token for `key` at `now`, refilling `per_minute` tokens a
    /// minute up to `per_minute`. On refusal, returns the seconds to wait.
    async fn take(&self, key: &str, per_minute: u32, now: u64) -> Result<(), u64> {
        let capacity = f64::from(per_minute);
        let per_second = capacity / 60.0;

        let mut buckets = self.0.write().await;
        let bucket = buckets.entry(key.to_owned()).or_insert(TokenBucket {
            tokens: capacity,
            last_refill: now,
        });

        // Beyond a day the bucket is full anyway, so saturating is exact enough.
        let elapsed = u32::try_from(now.saturating_sub(bucket.last_refill)).unwrap_or(u32::MAX);
        let tokens = f64::from(elapsed)
            .mul_add(per_second, bucket.tokens)
            .min(capacity);
        bucket.last_refill = now;

        if tokens < 1.0 {
            bucket.tokens = tokens;
            // Clamped to 1..=60 seconds, so the cast cannot truncate or wrap.
            #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
            let wait = ((1.0 - tokens) / per_second).ceil().clamp(1.0, 60.0) as u64;
            return Err(wait);
        }
        bucket.tokens = tokens - 1.0;
        Ok(())
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Global rate limiter for all IPs: 60 requests a minute, 120 when signed in.
#[derive(Debug, Default)]
pub struct RateLimiter {
    buckets: Buckets,
}

impl RateLimiter {
    pub const PUBLIC_PER_MINUTE: u32 = 60;
    pub const AUTHENTICATED_PER_MINUTE: u32 = 120;

    pub fn new() -> Self {
        Self::default()
    }

    pub async fn check_rate_limit(
        &self,
        ip: &str,
        is_authenticated: bool,
    ) -> Result<(), (StatusCode, String)> {
        let limit = if is_authenticated {
            Self::AUTHENTICATED_PER_MINUTE
        } else {
            Self::PUBLIC_PER_MINUTE
        };
        self.buckets
            .take(ip, limit, now())
            .await
            .map_err(|retry_after| {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    format!("Rate limit exceeded. Retry-After: {retry_after}"),
                )
            })
    }
}

/// Rate limiting middleware for global IP-based rate limiting.
pub async fn rate_limit_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<Body>,
    next: Next,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // One limiter for the process, so budgets survive between requests.
    static LIMITER: OnceLock<RateLimiter> = OnceLock::new();

    let is_authenticated = req.headers().contains_key("authorization");
    LIMITER
        .get_or_init(RateLimiter::new)
        .check_rate_limit(&addr.ip().to_string(), is_authenticated)
        .await?;

    Ok(next.run(req).await)
}

/// Velocity rate limiter for sensitive actions, keyed by user id (#136).
#[derive(Debug, Default)]
pub struct VelocityLimiter {
    buckets: Buckets,
}

impl VelocityLimiter {
    pub const PER_MINUTE: u32 = 5;

    pub fn new() -> Self {
        Self::default()
    }

    /// Whether `user_id` may perform another sensitive action now.
    pub async fn check_sensitive_action(&self, user_id: &str) -> Result<(), (StatusCode, String)> {
        self.check_at(user_id, now()).await
    }

    async fn check_at(&self, user_id: &str, now: u64) -> Result<(), (StatusCode, String)> {
        self.buckets
            .take(user_id, Self::PER_MINUTE, now)
            .await
            .map_err(|retry_after| {
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    format!(
                        "Too many requests. Maximum {} transfers per minute. Retry-After: {retry_after}",
                        Self::PER_MINUTE
                    ),
                )
            })
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_user_gets_five_sensitive_actions_a_minute() {
        let limiter = VelocityLimiter::new();
        for _ in 0..5 {
            assert!(limiter.check_at("alice", 1_000).await.is_ok());
        }
        let refused = limiter.check_at("alice", 1_000).await.unwrap_err();
        assert_eq!(refused.0, StatusCode::TOO_MANY_REQUESTS);
        assert!(refused.1.contains("Retry-After: 12"), "{}", refused.1);

        // Another user has their own budget.
        assert!(limiter.check_at("bob", 1_000).await.is_ok());
        // One token comes back every 12 seconds.
        assert!(limiter.check_at("alice", 1_012).await.is_ok());
    }

    #[tokio::test]
    async fn signed_in_callers_get_a_larger_budget() {
        let limiter = RateLimiter::new();
        for _ in 0..RateLimiter::PUBLIC_PER_MINUTE {
            assert!(limiter.buckets.take("ip", 60, 0).await.is_ok());
        }
        assert!(limiter.buckets.take("ip", 60, 0).await.is_err());
        for _ in 0..RateLimiter::AUTHENTICATED_PER_MINUTE {
            assert!(limiter.buckets.take("signed-in", 120, 0).await.is_ok());
        }
        assert!(limiter.buckets.take("signed-in", 120, 0).await.is_err());
    }
}
