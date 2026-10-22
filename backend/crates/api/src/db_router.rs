/// Database router that can route read/write operations to primary or replica pools.
/// 
/// Rules:
/// - Write operations (transfers, deposits, holds, etc.) always go to the primary database.
/// - Read operations (balances, feeds, statements) go to the replica if available and
///   the endpoint tolerates potential lag. Otherwise fall back to primary.
/// - If the replica is unavailable, always fall back to primary.
/// - Track replica lag to make routing decisions.
use std::sync::Arc;
use std::time::{Duration, Instant};
use sqlx::PgPool;
use tracing::{info, warn, instrument};

/// Represents the health and lag status of a replica database.
#[derive(Debug, Clone)]
pub struct ReplicaStatus {
    /// Whether the replica pool is available and connected.
    pub available: bool,
    /// How far behind the replica is compared to the primary (in seconds).
    /// None means we cannot determine the lag.
    pub lag_seconds: Option<f64>,
    /// When the replica status was last checked.
    pub last_checked: Instant,
}

/// A database router that can route to primary or replica pools.
/// 
/// Rules:
/// - Write operations always go to the primary database.
/// - Read operations go to the replica if available and the endpoint tolerates
///   potential lag. Otherwise fall back to primary.
/// - If the replica is unavailable, always fall back to primary.
pub struct DatabaseRouter {
    /// Primary database pool (always available for writes).
    primary_pool: Option<PgPool>,
    /// Replica database pool (may be None for read-only setups).
    replica_pool: Option<PgPool>,
    /// Current replica status (availability and lag).
    replica_status: ReplicaStatus,
    /// How long to wait before checking replica status again.
    status_check_interval: Duration,
}

impl DatabaseRouter {
    /// Create a new DatabaseRouter with optional primary and replica pools.
    pub fn new(primary_pool: Option<PgPool>, replica_pool: Option<PgPool>) -> Self {
        let now = Instant::now();
        Self {
            primary_pool,
            replica_pool,
            replica_status: ReplicaStatus {
                available: replica_pool.is_some(),
                lag_seconds: None,
                last_checked: now,
            },
            status_check_interval: Duration::from_secs(30),
        }
    }

    /// Check the replica status and update internal state.
    #[instrument(skip(self))]
    pub async fn check_replica_status(&mut self) -> &ReplicaStatus {
        let start = Instant::now();
        
        if let Some(pool) = &self.replica_pool {
            // Try a simple query to check if the replica is available
            // and measure lag if possible
            match self.check_replica_availability(pool).await {
                Ok(status) => {
                    self.replica_status = status;
                    info!(
                        "Replica status checked in {:?}. Available: {}, Lag: {:?}s",
                        start.elapsed(),
                        status.available,
                        status.lag_seconds
                    );
                }
                Err(e) => {
                    warn!("Failed to check replica status: {}", e);
                    self.replica_status.available = false;
                    self.replica_status.lag_seconds = None;
                }
            }
        } else {
            self.replica_status.available = false;
        }
        
        &self.replica_status
    }

    /// Check if we should use the replica for a read operation.
    /// 
    /// @param tolerance_seconds Maximum acceptable replica lag in seconds.
    /// @param is_money_operation true if this is a balance check or money-moving path
    ///   that must always read from the primary to prevent stale data.
    /// @return true if replica should be used, false if primary should be used.
    pub fn should_use_replica(&self, tolerance_seconds: f64, is_money_operation: bool) -> bool {
        // Money-moving paths must always read from the primary to prevent stale data
        // that could lead to double-spending or incorrect balances.
        if is_money_operation {
            return false;
        }
        
        if !self.replica_status.available {
            return false;
        }
        
        match self.replica_status.lag_seconds {
            Some(lag) if lag <= tolerance_seconds => true,
            Some(lag) if lag > tolerance_seconds => {
                // Replica is too far behind, fall back to primary
                false
            }
            None => {
                // Cannot determine lag, be conservative and use primary
                false
            }
        }
    }

    /// Get a reference to the appropriate pool for the operation type.
    pub fn get_pool_for_write(&self) -> Option<&PgPool> {
        self.primary_pool.as_ref()
    }

    pub fn get_pool_for_read(&self, use_replica: bool) -> Option<&PgPool> {
        if use_replica {
            self.replica_pool.as_ref()
        } else {
            self.primary_pool.as_ref()
        }
    }

    /// Execute a read query with automatic fallback to primary if replica is unavailable.
    #[instrument(skip(self, query_fn))]
    pub async fn read_with_fallback<F, T>(&self, query_fn: F) -> Result<T, sqlx::Error>
    where
        F: FnOnce(&PgPool) -> impl Future<Output = Result<T, sqlx::Error>> + Send,
    {
        let status = self.check_replica_status().await;
        let use_replica = self.should_use_replica(5.0, is_money_operation); // 5 second tolerance        
        let pool = self.get_pool_for_read(use_replica);
        
        if let Some(pool) = pool {
            info!("Executing read query on {}", if use_replica { "replica" } else { "primary" });
            query_fn(pool).await
        } else {
            // Fallback to primary
            if let Some(primary) = &self.primary_pool {
                info!("Replica unavailable, falling back to primary");
                query_fn(primary).await
            } else {
                Err(sqlx::Error::PoolNotInitialized)
            }
        }
    }

    /// Execute a write query always on the primary pool.
    #[instrument(skip(self, write_fn))]
    pub async fn write_with_primary<F, T>(&self, write_fn: F) -> Result<T, sqlx::Error>
    where
        F: FnOnce(&PgPool) -> impl Future<Output = Result<T, sqlx::Error>> + Send,
    {
        let primary = self.primary_pool.as_ref()
            .ok_or_else(|| sqlx::Error::PoolNotInitialized)??;
        
        info!("Executing write query on primary");
        write_fn(primary).await
    }

    async fn check_replica_availability(&self, pool: &PgPool) -> Result<ReplicaStatus, sqlx::Error> {
        // Try a simple query to verify the replica is accessible
        let result = sqlx::query("SELECT 1 AS healthy")
            .fetch_one(pool)
            .await?;
        
        // Check replication lag if possible (PostgreSQL specific)
        // We try to get the difference between primary and replica commit timestamps
        let lag_seconds: Option<f64> = self.try_measure_lag(pool).await;
        
        Ok(ReplicaStatus {
            available: true,
            lag_seconds,
            last_checked: Instant::now(),
        })
    }

    async fn try_measure_lag(&self, pool: &PgPool) -> Option<f64> {
        // Try to get replication slot info or commit timestamps
        // This is PostgreSQL-specific and may not be available in all setups
        // For now, we'll try to get the latest transaction timestamp
        
        // Method 1: Try to get the latest transaction timestamp from the primary
        // and compare with replica (if we had separate pools we could compare)
        // Since we share the same instance for now, return None
        
        // For future: could check pg_replication_slots, pg_stat_replication, etc.
        // But those require access to the primary's system views
        
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::PgPool;
    
    #[tokio::test]
    async fn test_replica_status_check() {
        // Test with no replica pool
        let router = DatabaseRouter::new(Some(create_test_pool().await), None);
        let status = router.check_replica_status().await;
        assert!(!status.available);
    }
    
    async fn create_test_pool() -> PgPool {
        // This would need a real PostgreSQL connection
        // For now, just return a lazy pool
        PgPool::connect_lazy("postgres://invalid")
    }
}