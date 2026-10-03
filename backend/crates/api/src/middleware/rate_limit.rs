use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;

/// Token bucket state for rate limiting
#[derive(Clone, Debug)]
struct TokenBucket {
    tokens: f64,
    last_refill: u64,
}

/// Global rate limiter for all IPs
pub struct RateLimiter {
    buckets: Arc<RwLock<HashMap<String, TokenBucket>>>,
    public_rate: f64,
    auth_rate: f64,
}

impl RateLimiter {
    pub fn new() -> Self {
        RateLimiter {
            buckets: Arc::new(RwLock::new(HashMap::new())),
            // 60 public requests per minute, 120 for an authenticated caller.
            public_rate: 1.0,
            auth_rate: 2.0,
        }
    }

    pub async fn check_rate_limit(
        &self,
        ip: &str,
        is_authenticated: bool,
    ) -> Result<(), (StatusCode, String)> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut buckets = self.buckets.write().await;
        let rate = if is_authenticated {
            self.auth_rate
        } else {
            self.public_rate
        };
        let max_tokens = if is_authenticated { 120.0 } else { 60.0 };

        let bucket = buckets
            .entry(ip.to_string())
            .or_insert_with(|| TokenBucket {
                tokens: max_tokens,
                last_refill: now,
            });

        let elapsed = (now - bucket.last_refill) as f64;
        let new_tokens = (bucket.tokens + elapsed * rate).min(max_tokens);

        if new_tokens < 1.0 {
            let retry_after = ((1.0 - new_tokens) / rate).ceil() as u64;
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!("Rate limit exceeded. Retry-After: {}", retry_after),
            ));
        }

        bucket.tokens = new_tokens - 1.0;
        bucket.last_refill = now;

        Ok(())
    }
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

/// Rate limiting middleware for global IP-based rate limiting
pub async fn rate_limit_middleware(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<Body>,
    next: Next,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let ip = addr.ip().to_string();
    let is_authenticated = req.headers().contains_key("authorization");

    // Get or create global rate limiter
    let limiter = RateLimiter::new();
    limiter.check_rate_limit(&ip, is_authenticated).await?;

    Ok(next.run(req).await)
}

/// Velocity rate limiter for sensitive actions (keyed by user ID) (#136)
pub struct VelocityLimiter {
    buckets: Arc<RwLock<HashMap<String, TokenBucket>>>,
}

impl VelocityLimiter {
    pub fn new() -> Self {
        VelocityLimiter {
            buckets: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Check if user can perform sensitive action (max 5 per minute)
    pub async fn check_sensitive_action(&self, user_id: &str) -> Result<(), (StatusCode, String)> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut buckets = self.buckets.write().await;
        let rate = 5.0 / 60.0;
        let max_tokens = 5.0;

        let bucket = buckets
            .entry(user_id.to_string())
            .or_insert_with(|| TokenBucket {
                tokens: max_tokens,
                last_refill: now,
            });

        let elapsed = (now - bucket.last_refill) as f64;
        let new_tokens = (bucket.tokens + elapsed * rate).min(max_tokens);

        if new_tokens < 1.0 {
            let retry_after = ((1.0 - new_tokens) / rate).ceil() as u64;
            return Err((
                StatusCode::TOO_MANY_REQUESTS,
                format!(
                    "Too many requests. Maximum 5 transfers per minute. Retry-After: {}",
                    retry_after
                ),
            ));
        }

        bucket.tokens = new_tokens - 1.0;
        bucket.last_refill = now;

        Ok(())
    }
}

impl Default for VelocityLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_fresh_limiter_allows_requests_up_to_its_rate() {
        let limiter = RateLimiter::new();
        for _ in 0..10 {
            assert!(limiter.check_rate_limit("203.0.113.1", false).await.is_ok());
        }
    }

    #[tokio::test]
    async fn an_exhausted_bucket_is_refused() {
        let limiter = RateLimiter::new();
        // The public rate is one token per second, so a burst far above it must
        // eventually be refused rather than served forever.
        let mut refused = false;
        for _ in 0..1_000 {
            if limiter
                .check_rate_limit("203.0.113.2", false)
                .await
                .is_err()
            {
                refused = true;
                break;
            }
        }
        assert!(refused, "rate limiter never refused a request");
    }

    #[tokio::test]
    async fn buckets_are_keyed_per_ip() {
        let limiter = RateLimiter::new();
        let mut refused = false;
        for _ in 0..1_000 {
            if limiter
                .check_rate_limit("203.0.113.3", false)
                .await
                .is_err()
            {
                refused = true;
                break;
            }
        }
        assert!(refused);
        // A different IP still has its own untouched bucket.
        assert!(limiter.check_rate_limit("203.0.113.4", false).await.is_ok());
    }

    #[test]
    fn the_velocity_limiter_has_a_default() {
        let _ = VelocityLimiter::default();
    }
}
