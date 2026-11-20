//! Prometheus-format metrics for the API service.
//!
//! Global atomic counters are updated by middleware and route handlers; the
//! `/metrics` endpoint renders them in Prometheus text exposition format
//! (version 0.0.4).  The endpoint is mounted outside `/v1` so it is never
//! reachable through the public API prefix.

use std::sync::atomic::{AtomicU64, Ordering};

// ── HTTP request metrics ──────────────────────────────────────────────────────

/// Total requests routed through the API service, split by path prefix.
pub static REQUESTS_V1: AtomicU64 = AtomicU64::new(0);
pub static REQUESTS_OTHER: AtomicU64 = AtomicU64::new(0);

/// Cumulative request-processing time in microseconds, split by path prefix.
pub static DURATION_US_V1: AtomicU64 = AtomicU64::new(0);
pub static DURATION_US_OTHER: AtomicU64 = AtomicU64::new(0);

// ── Withdrawal metrics ────────────────────────────────────────────────────────

pub static WITHDRAWALS_PENDING: AtomicU64 = AtomicU64::new(0);
pub static WITHDRAWALS_BROADCAST: AtomicU64 = AtomicU64::new(0);
pub static WITHDRAWALS_FAILED: AtomicU64 = AtomicU64::new(0);

// ── Deposit metrics ───────────────────────────────────────────────────────────

pub static DEPOSITS_RECEIVED: AtomicU64 = AtomicU64::new(0);

// ── Renderer ─────────────────────────────────────────────────────────────────

/// Renders all metrics in Prometheus text exposition format.
pub fn render() -> String {
    let mut out = String::with_capacity(1_024);

    write_section(
        &mut out,
        "api_http_requests_total",
        "counter",
        "Total HTTP requests received by the API service.",
        &[
            ("v1", REQUESTS_V1.load(Ordering::Relaxed)),
            ("other", REQUESTS_OTHER.load(Ordering::Relaxed)),
        ],
    );

    write_section(
        &mut out,
        "api_http_request_duration_us_total",
        "gauge",
        "Cumulative request-processing time in microseconds.",
        &[
            ("v1", DURATION_US_V1.load(Ordering::Relaxed)),
            ("other", DURATION_US_OTHER.load(Ordering::Relaxed)),
        ],
    );

    write_simple(
        &mut out,
        "api_withdrawals_pending_total",
        "gauge",
        "Withdrawals currently in the pending state.",
        WITHDRAWALS_PENDING.load(Ordering::Relaxed),
    );

    write_section(
        &mut out,
        "api_withdrawals_total",
        "counter",
        "Withdrawal state transitions observed by the API.",
        &[
            ("broadcast", WITHDRAWALS_BROADCAST.load(Ordering::Relaxed)),
            ("failed", WITHDRAWALS_FAILED.load(Ordering::Relaxed)),
        ],
    );

    write_simple(
        &mut out,
        "api_deposits_received_total",
        "counter",
        "Deposit webhook events received.",
        DEPOSITS_RECEIVED.load(Ordering::Relaxed),
    );

    out
}

fn write_section(out: &mut String, name: &str, kind: &str, help: &str, rows: &[(&str, u64)]) {
    out.push_str(&format!("# HELP {name} {help}\n# TYPE {name} {kind}\n"));
    for (label, value) in rows {
        out.push_str(&format!("{name}{{prefix=\"{label}\"}} {value}\n"));
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
    fn render_produces_valid_prometheus_text() {
        let output = render();
        assert!(output.contains("# HELP api_http_requests_total"));
        assert!(output.contains("# TYPE api_http_requests_total counter"));
        assert!(output.contains("api_withdrawals_total"));
        assert!(output.contains("api_deposits_received_total"));
    }

    #[test]
    fn counter_increments_are_visible_in_render() {
        let before = REQUESTS_V1.load(Ordering::Relaxed);
        REQUESTS_V1.fetch_add(1, Ordering::Relaxed);
        let after = REQUESTS_V1.load(Ordering::Relaxed);
        assert_eq!(after, before + 1, "counter must increment");

        let output = render();
        assert!(
            output.contains(&format!("api_http_requests_total{{prefix=\"v1\"}} {after}")),
            "rendered output must reflect incremented counter"
        );

        REQUESTS_V1.fetch_sub(1, Ordering::Relaxed);
    }
}
