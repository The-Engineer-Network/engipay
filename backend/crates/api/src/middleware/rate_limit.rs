use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::IntoResponse;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
struct TokenBucket {
    tokens: f64,
    last_refill: u64,
}

pub struct RateLimiter {
    buckets: Arc<RwLock<HashMap<String, TokenBucket>>>,
    public_rate: f64,
    auth_rate: f64,
}

impl RateLimiter {
    pub fn new() -> Self {
        RateLimiter {
            buckets: Arc::new(RwLock::new(HashMap::new())),
            public_rate: 60.0 / 60.0,
            auth_rate: 120.0 / 60.0,
        }
    }

    pub async fn check_rate_limit(&self, ip: &str, is_authenticated: bool) -> Result<(), (StatusCode, String)> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let mut buckets = self.buckets.write().await;
        let rate = if is_authenticated { self.auth_rate } else { self.public_rate };
        let max_tokens = if is_authenticated { 120.0 } else { 60.0 };

        let bucket = buckets.entry(ip.to_string()).or_insert_with(|| TokenBucket {
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

pub async fn rate_limit_middleware<B>(
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: Request<B>,
    next: Next,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let ip = addr.ip().to_string();
    let is_authenticated = req.headers().contains_key("authorization");

    let limiter = RateLimiter::new();
    limiter.check_rate_limit(&ip, is_authenticated).await?;

    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
}
