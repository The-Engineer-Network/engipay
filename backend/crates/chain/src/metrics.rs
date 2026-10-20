//! Prometheus-format metrics for the chain service.
//!
//! Each metric is a global atomic counter or gauge so handlers and the watcher
//! loop can update them without holding a lock, and the `/metrics` handler
//! reads them in a single pass.

use std::sync::atomic::{AtomicU64, Ordering};

// ── HTTP request metrics ──────────────────────────────────────────────────────

pub static REQUESTS_ESTIMATE_FEE: AtomicU64 = AtomicU64::new(0);
pub static REQUESTS_CREATE_WALLET: AtomicU64 = AtomicU64::new(0);

/// Cumulative request processing time in microseconds, split by route.
pub static DURATION_US_ESTIMATE_FEE: AtomicU64 = AtomicU64::new(0);
pub static DURATION_US_CREATE_WALLET: AtomicU64 = AtomicU64::new(0);

// ── Watcher metrics ───────────────────────────────────────────────────────────

/// Ledger sequence of the last batch processed by the deposit watcher.
pub static LAST_PROCESSED_LEDGER: AtomicU64 = AtomicU64::new(0);

/// Total deposits forwarded to the creditor since start.
pub static DEPOSITS_CREDITED: AtomicU64 = AtomicU64::new(0);

/// Current size of the dead-letter queue (best-effort; updated each poll).
pub static DLQ_SIZE: AtomicU64 = AtomicU64::new(0);

// ── Withdrawal metrics ────────────────────────────────────────────────────────

pub static WITHDRAWALS_SENT: AtomicU64 = AtomicU64::new(0);
pub static WITHDRAWALS_FAILED: AtomicU64 = AtomicU64::new(0);

// ── Renderer ─────────────────────────────────────────────────────────────────

/// Renders all metrics in Prometheus text exposition format (version 0.0.4).
pub fn render() -> String {
    use Ordering::Relaxed;

    let mut out = String::with_capacity(1_024);

    write_counter(
        &mut out,
        "chain_http_requests_total",
        "Total requests received by the chain service internal HTTP API.",
        &[
            ("estimate_fee", REQUESTS_ESTIMATE_FEE.load(Relaxed)),
            ("create_wallet", REQUESTS_CREATE_WALLET.load(Relaxed)),
        ],
    );

    write_gauge(
        &mut out,
        "chain_http_request_duration_us_total",
        "Cumulative request-processing time in microseconds.",
        &[
            ("estimate_fee", DURATION_US_ESTIMATE_FEE.load(Relaxed)),
            ("create_wallet", DURATION_US_CREATE_WALLET.load(Relaxed)),
        ],
    );

    write_simple(
        &mut out,
        "chain_last_processed_ledger",
        "gauge",
        "Ledger sequence of the most recent batch processed by the deposit watcher.",
        LAST_PROCESSED_LEDGER.load(Relaxed),
    );

    write_simple(
        &mut out,
        "chain_deposits_credited_total",
        "counter",
        "Deposits forwarded to the creditor since start.",
        DEPOSITS_CREDITED.load(Relaxed),
    );

    write_simple(
        &mut out,
        "chain_dlq_size",
        "gauge",
        "Number of items currently in the dead-letter queue.",
        DLQ_SIZE.load(Relaxed),
    );

    write_counter(
        &mut out,
        "chain_withdrawals_total",
        "Withdrawal broadcast attempts split by outcome.",
        &[
            ("sent", WITHDRAWALS_SENT.load(Relaxed)),
            ("failed", WITHDRAWALS_FAILED.load(Relaxed)),
        ],
    );

    out
}

fn write_counter(out: &mut String, name: &str, help: &str, rows: &[(&str, u64)]) {
    out.push_str(&format!("# HELP {name} {help}\n# TYPE {name} counter\n"));
    for (label, value) in rows {
        out.push_str(&format!("{name}{{route=\"{label}\"}} {value}\n"));
    }
}

fn write_gauge(out: &mut String, name: &str, help: &str, rows: &[(&str, u64)]) {
    out.push_str(&format!("# HELP {name} {help}\n# TYPE {name} gauge\n"));
    for (label, value) in rows {
        out.push_str(&format!("{name}{{route=\"{label}\"}} {value}\n"));
    }
}

fn write_simple(out: &mut String, name: &str, kind: &str, help: &str, value: u64) {
    out.push_str(&format!(
        "# HELP {name} {help}\n# TYPE {name} {kind}\n{name} {value}\n"
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counters_start_at_zero() {
        // These are global statics; we only verify the render is well-formed.
        let output = render();
        assert!(output.contains("chain_http_requests_total"));
        assert!(output.contains("chain_deposits_credited_total"));
        assert!(output.contains("chain_dlq_size"));
        assert!(output.contains("chain_last_processed_ledger"));
        assert!(output.contains("chain_withdrawals_total"));
    }

    #[test]
    fn counter_increments_are_visible_in_render() {
        // Snapshot before, increment, snapshot after.
        let before = DEPOSITS_CREDITED.load(Ordering::Relaxed);
        DEPOSITS_CREDITED.fetch_add(1, Ordering::Relaxed);
        let after = DEPOSITS_CREDITED.load(Ordering::Relaxed);
        assert_eq!(after, before + 1, "counter must increment");

        // The rendered output must contain the new value.
        let output = render();
        assert!(
            output.contains(&format!("chain_deposits_credited_total {after}")),
            "rendered output must reflect incremented counter"
        );

        // Restore to avoid interfering with other tests.
        DEPOSITS_CREDITED.fetch_sub(1, Ordering::Relaxed);
    }
}
