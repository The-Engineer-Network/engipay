-- Migration 0020: chain service leader election visibility.
--
-- The chain service uses pg_try_advisory_lock(key) for per-network leader
-- election so only one instance processes ledgers per network at a time.
-- No dedicated table is needed — Postgres releases session-level advisory
-- locks automatically when the connection drops, giving clean handover on
-- both graceful shutdown and crashes.
--
-- This view makes it easy for operators to see which backend connection
-- currently leads each network, and lets the /metrics endpoint report
-- chain_is_leader without a separate table query.
--
-- Lock key derivation (matches leader.rs):
--   The first 8 bytes of the ASCII chain name, zero-padded, interpreted as
--   a little-endian i64.
--
--   chain    | bytes (hex, LE)
--   ---------|-------------------
--   stellar  | 73 74 65 6c 6c 61 72 00
--   base     | 62 61 73 65 00 00 00 00
--   bitcoin  | 62 69 74 63 6f 69 6e 00

CREATE VIEW chain_leaders AS
SELECT
    l.objid                                     AS lock_key,
    a.pid,
    a.application_name,
    a.state,
    a.query_start                               AS lock_held_since,
    a.client_addr
FROM pg_locks      l
JOIN pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'advisory'
  AND l.granted  = true
  AND l.classid  = 0;   -- session-level advisory locks use objid only

COMMENT ON VIEW chain_leaders IS
    'Shows which Postgres backend currently holds each chain-service advisory '
    'lock (leader election). One row per held lock; empty when no chain service '
    'instance is running or connected.';
