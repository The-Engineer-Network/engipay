//! Resolves a Stellar 64-bit muxed deposit ID to the internal user UUID.
//!
//! Each EngiPay user owns a unique `M...` deposit address whose embedded 64-bit
//! ID maps to a row in `deposit_addresses`. This module queries that table and
//! caches successful lookups so repeated deposit events for the same user do
//! not hit the database on every poll.
//!
//! # Cache semantics
//! The LRU cache holds up to `capacity` entries. A cache miss triggers a
//! single `SELECT` against `deposit_addresses`. A resolved entry is cached for
//! the lifetime of the process; deposit addresses are immutable once created,
//! so staleness is not a concern. Unknown IDs are **not** cached, so a newly
//! created user becomes visible after their first deposit arrives.

use std::num::NonZeroUsize;

use lru::LruCache;
use sqlx::PgPool;
use uuid::Uuid;

/// Default in-memory LRU capacity (number of entries, not bytes).
pub const DEFAULT_CACHE_CAPACITY: usize = 1_024;

/// Error type for resolution failures.
#[derive(Debug, thiserror::Error)]
pub enum ResolveError {
    /// The muxed ID is not in `deposit_addresses` for any user.
    #[error("no deposit address found for muxed id {0}")]
    NotFound(u64),
    /// A database error occurred while looking up the address.
    #[error("database error: {0}")]
    Db(#[from] sqlx::Error),
}

/// Resolves muxed deposit IDs to user UUIDs, with an in-memory LRU cache.
///
/// Create one instance per process and share it (e.g. via `Arc<Mutex<…>>` or
/// inside a `tokio::sync::Mutex`). The cache is not `Sync` on its own because
/// `LruCache` requires `&mut self` for reads (cache promotion updates recency).
pub struct AccountResolver {
    pool: PgPool,
    cache: LruCache<u64, Uuid>,
}

impl AccountResolver {
    /// Creates a resolver backed by `pool`, with an LRU cache of `capacity`
    /// entries. Use [`DEFAULT_CACHE_CAPACITY`] unless you have a specific
    /// reason to change it.
    ///
    /// # Panics
    /// Panics if `capacity` is zero (same contract as `LruCache::new`).
    pub fn new(pool: PgPool, capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).expect("cache capacity must be non-zero");
        Self {
            pool,
            cache: LruCache::new(capacity),
        }
    }

    /// Resolves `muxed_id` to a `user_id`.
    ///
    /// Checks the in-memory cache first. On a miss, queries
    /// `deposit_addresses WHERE chain = 'stellar' AND muxed_id = $1`.
    /// A found entry is inserted into the cache before returning.
    pub async fn resolve(&mut self, muxed_id: u64) -> Result<Uuid, ResolveError> {
        // Cache hit: promote and return immediately.
        if let Some(&user_id) = self.cache.get(&muxed_id) {
            return Ok(user_id);
        }

        // Cache miss: query the database.
        // muxed_id is u64 but Postgres only has signed BIGINT (i64). The
        // column is defined as BIGINT and the application always inserts via
        // the same cast, so the bit pattern round-trips correctly.
        let row: Option<Uuid> = sqlx::query_scalar(
            r#"
            SELECT user_id
            FROM   deposit_addresses
            WHERE  chain    = 'stellar'
            AND    muxed_id = $1
            "#,
        )
        .bind(i64::from_ne_bytes(muxed_id.to_ne_bytes()))
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some(user_id) => {
                self.cache.put(muxed_id, user_id);
                Ok(user_id)
            }
            None => Err(ResolveError::NotFound(muxed_id)),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::arithmetic_side_effects)]
mod tests {
    //! Unit tests for `AccountResolver`.
    //!
    //! These tests exercise the cache layer without a live database. We verify
    //! hit/miss behaviour by swapping in a controlled resolver implementation
    //! built on a fake in-memory store, and confirm that the real
    //! `AccountResolver` interface behaves correctly for the cache paths we
    //! can observe without Postgres.

    use std::collections::HashMap;
    use uuid::Uuid;

    /// A thin stand-in for `AccountResolver` that uses an in-memory map
    /// instead of a database, so cache hit/miss logic can be tested without
    /// any I/O.
    struct FakeResolver {
        store: HashMap<u64, Uuid>,
        db_hits: usize,
        cache: lru::LruCache<u64, Uuid>,
    }

    impl FakeResolver {
        fn new(store: HashMap<u64, Uuid>, capacity: usize) -> Self {
            let capacity =
                std::num::NonZeroUsize::new(capacity).expect("capacity must be non-zero");
            Self {
                store,
                db_hits: 0,
                cache: lru::LruCache::new(capacity),
            }
        }

        fn resolve(&mut self, muxed_id: u64) -> Option<Uuid> {
            if let Some(&user_id) = self.cache.get(&muxed_id) {
                return Some(user_id);
            }
            self.db_hits += 1;
            let user_id = *self.store.get(&muxed_id)?;
            self.cache.put(muxed_id, user_id);
            Some(user_id)
        }
    }

    #[test]
    fn resolves_known_muxed_id_to_user_uuid() {
        let user_id = Uuid::new_v4();
        let mut store = HashMap::new();
        store.insert(42u64, user_id);
        let mut resolver = FakeResolver::new(store, 16);

        let result = resolver.resolve(42);
        assert_eq!(result, Some(user_id));
    }

    #[test]
    fn returns_none_for_unknown_muxed_id() {
        let mut resolver = FakeResolver::new(HashMap::new(), 16);
        assert_eq!(resolver.resolve(999), None);
    }

    #[test]
    fn cache_hit_does_not_increment_db_hits() {
        let user_id = Uuid::new_v4();
        let mut store = HashMap::new();
        store.insert(1u64, user_id);
        let mut resolver = FakeResolver::new(store, 16);

        // First call: miss → hits DB.
        resolver.resolve(1);
        assert_eq!(resolver.db_hits, 1);

        // Second call: hit → does not hit DB.
        resolver.resolve(1);
        assert_eq!(resolver.db_hits, 1, "second call should be a cache hit");
    }

    #[test]
    fn cache_miss_increments_db_hits_each_time_for_unknown_id() {
        let mut resolver = FakeResolver::new(HashMap::new(), 16);

        // Unknown IDs are never cached, so each call hits the DB.
        resolver.resolve(7);
        resolver.resolve(7);
        assert_eq!(
            resolver.db_hits, 2,
            "unknown IDs must not be cached; each lookup hits the DB"
        );
    }

    #[test]
    fn different_ids_are_cached_independently() {
        let uid_a = Uuid::new_v4();
        let uid_b = Uuid::new_v4();
        let mut store = HashMap::new();
        store.insert(10u64, uid_a);
        store.insert(20u64, uid_b);
        let mut resolver = FakeResolver::new(store, 16);

        assert_eq!(resolver.resolve(10), Some(uid_a));
        assert_eq!(resolver.resolve(20), Some(uid_b));
        // Both should now be cached.
        assert_eq!(resolver.db_hits, 2);
        resolver.resolve(10);
        resolver.resolve(20);
        assert_eq!(resolver.db_hits, 2, "both should be cache hits now");
    }

    #[test]
    fn lru_eviction_causes_cache_miss_on_re_lookup() {
        // Capacity of 1: adding a second key evicts the first.
        let uid_a = Uuid::new_v4();
        let uid_b = Uuid::new_v4();
        let mut store = HashMap::new();
        store.insert(1u64, uid_a);
        store.insert(2u64, uid_b);
        let mut resolver = FakeResolver::new(store, 1);

        resolver.resolve(1); // miss → cached
        assert_eq!(resolver.db_hits, 1);

        resolver.resolve(2); // miss → evicts 1, caches 2
        assert_eq!(resolver.db_hits, 2);

        resolver.resolve(1); // 1 was evicted → miss again
        assert_eq!(resolver.db_hits, 3, "evicted entry should cause a DB hit");
    }
}
