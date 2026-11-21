//! Prometheus-format metrics for the API service.
//!
//! Global atomic counters are updated by middleware and route handlers; the
//! `/metrics` endpoint renders them in Prometheus text exposition format
//! (version 0.0.4).  The endpoint is mounted outside `/v1` so it is never
//! reachable through the public API prefix.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

// ── HTTP request metrics ──────────────────────────────────────────────────────

/// Total requests routed through the API service, split by path prefix.
pub static REQUESTS_V1: AtomicU64 = AtomicU64::new(0);
pub static REQUESTS_OTHER: AtomicU64 = AtomicU64::new(0);

/// Cumulative request-processing time in microseconds, split by path prefix.
pub static DURATION_US_V1: AtomicU64 = AtomicU64::new(0);
pub static DURATION_US_OTHER: AtomicU64 = AtomicU64::new(0);

// ── Per-route request metrics ─────────────────────────────────────────────────

/// Request count and cumulative latency (microseconds) for one route/status class.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RouteStat {
    pub count: u64,
    pub duration_us: u64,
}

type RouteKey = (String, &'static str, &'static str);

fn route_stats() -> &'static Mutex<BTreeMap<RouteKey, RouteStat>> {
    static STATS: OnceLock<Mutex<BTreeMap<RouteKey, RouteStat>>> = OnceLock::new();
    STATS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

/// Maps an HTTP status code to its class label (`2xx`, `4xx`, ...).
pub fn status_class(status: u16) -> &'static str {
    match status {
        100..=199 => "1xx",
        200..=299 => "2xx",
        300..=399 => "3xx",
        400..=499 => "4xx",
        500..=599 => "5xx",
        _ => "other",
    }
}

/// Records one request against its matched route template (never the raw
/// path, so label cardinality stays bounded by the number of routes).
pub fn record_route(route: &str, method: &'static str, status: u16, duration_us: u64) {
    let mut stats = route_stats()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = stats
        .entry((route.to_owned(), method, status_class(status)))
        .or_default();
    entry.count = entry.count.saturating_add(1);
    entry.duration_us = entry.duration_us.saturating_add(duration_us);
}

/// Snapshot of the per-route stats for `(route, method, status_class)`.
pub fn route_stat(route: &str, method: &'static str, class: &'static str) -> RouteStat {
    route_stats()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&(route.to_owned(), method, class))
        .copied()
        .unwrap_or_default()
}

fn escape_label(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n")
}

fn render_route_metrics(out: &mut String) {
    let stats = route_stats()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    out.push_str("# HELP api_http_route_requests_total Requests by matched route template, method and status class.\n# TYPE api_http_route_requests_total counter\n");
    for ((route, method, class), stat) in stats.iter() {
        out.push_str(&format!(
            "api_http_route_requests_total{{route=\"{}\",method=\"{method}\",status_class=\"{class}\"}} {}\n",
            escape_label(route),
            stat.count
        ));
    }
    out.push_str("# HELP api_http_route_duration_us_total Cumulative latency in microseconds by matched route template, method and status class.\n# TYPE api_http_route_duration_us_total counter\n");
    for ((route, method, class), stat) in stats.iter() {
        out.push_str(&format!(
            "api_http_route_duration_us_total{{route=\"{}\",method=\"{method}\",status_class=\"{class}\"}} {}\n",
            escape_label(route),
            stat.duration_us
        ));
    }
}

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

    render_route_metrics(&mut out);

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
    fn status_classes() {
        assert_eq!(status_class(200), "2xx");
        assert_eq!(status_class(404), "4xx");
        assert_eq!(status_class(503), "5xx");
        assert_eq!(status_class(99), "other");
    }

    #[test]
    fn route_metrics_are_labelled_by_template_and_status_class() {
        record_route("/v1/test-route/{id}", "GET", 200, 40);
        record_route("/v1/test-route/{id}", "GET", 204, 60);
        record_route("/v1/test-route/{id}", "GET", 500, 5);

        let ok = route_stat("/v1/test-route/{id}", "GET", "2xx");
        assert_eq!(ok, RouteStat { count: 2, duration_us: 100 });
        assert_eq!(route_stat("/v1/test-route/{id}", "GET", "5xx").count, 1);

        let output = render();
        assert!(output.contains(
            "api_http_route_requests_total{route=\"/v1/test-route/{id}\",method=\"GET\",status_class=\"2xx\"} 2"
        ));
        assert!(output.contains("api_http_route_duration_us_total{route=\"/v1/test-route/{id}\""));
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
