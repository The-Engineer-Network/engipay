use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::LazyLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

// One token is 60 credits, keeping fractional refills exact without floats.
#[derive(Debug)]
struct TokenBucket {
    credits: u64,
    last_refill: u64,
}
impl TokenBucket {
    fn take(&mut self, now: u64, per_minute: u64) -> Result<(), u64> {
        let elapsed = now.saturating_sub(self.last_refill);
        self.credits = self
            .credits
            .saturating_add(elapsed.saturating_mul(per_minute))
            .min(per_minute.saturating_mul(60));
        self.last_refill = self.last_refill.max(now);
        if self.credits < 60 {
            return Err(60u64.saturating_sub(self.credits).div_ceil(per_minute));
        }
        self.credits = self.credits.saturating_sub(60);
        Ok(())
    }
}
#[derive(Default)]
pub struct RateLimiter {
    buckets: RwLock<HashMap<String, TokenBucket>>,
}
impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }
    async fn check(&self, key: &str, per_minute: u64) -> Result<(), (StatusCode, String)> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut buckets = self.buckets.write().await;
        let bucket = buckets.entry(key.to_owned()).or_insert(TokenBucket {
            credits: per_minute.saturating_mul(60),
            last_refill: now,
        });
        bucket.take(now, per_minute).map_err(|retry| {
            (
                StatusCode::TOO_MANY_REQUESTS,
                format!("Rate limit exceeded. Retry-After: {retry}"),
            )
        })
    }
    pub async fn check_rate_limit(
        &self,
        ip: &str,
        is_authenticated: bool,
    ) -> Result<(), (StatusCode, String)> {
        self.check(ip, if is_authenticated { 120 } else { 60 })
            .await
    }
}
static RATE_LIMITER: LazyLock<RateLimiter> = LazyLock::new(RateLimiter::new);
pub async fn rate_limit_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<Body>,
    next: Next,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    // A header alone is not proof of authentication.
    RATE_LIMITER
        .check_rate_limit(&addr.ip().to_string(), false)
        .await?;
    Ok(next.run(req).await)
}
#[derive(Default)]
pub struct VelocityLimiter {
    limiter: RateLimiter,
}
impl VelocityLimiter {
    pub fn new() -> Self {
        Self::default()
    }
    pub async fn check_sensitive_action(&self, user_id: &str) -> Result<(), (StatusCode, String)> {
        self.limiter.check(user_id, 5).await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refill_is_exact_and_clock_rollback_adds_no_tokens() {
        let mut bucket = TokenBucket {
            credits: 0,
            last_refill: 100,
        };
        assert_eq!(bucket.take(99, 5), Err(12));
        assert_eq!(bucket.take(111, 5), Err(1));
        assert_eq!(bucket.take(112, 5), Ok(()));
        assert_eq!(bucket.take(112, 5), Err(12));
    }
    #[tokio::test]
    async fn sensitive_actions_are_limited_per_user() {
        let limiter = VelocityLimiter::new();
        for _ in 0..5 {
            assert!(limiter.check_sensitive_action("alice").await.is_ok());
        }
        assert_eq!(
            limiter
                .check_sensitive_action("alice")
                .await
                .expect_err("sixth action")
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert!(limiter.check_sensitive_action("bob").await.is_ok());
    }
}
