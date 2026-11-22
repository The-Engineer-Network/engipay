//! Computed status for money requests (#694).

use chrono::{DateTime, Utc};

/// The status to show for a request: a `pending` request past `expires_at`
/// is reported as `expired`, whatever is stored. Other statuses pass through.
pub fn effective_status(status: &str, expires_at: DateTime<Utc>, now: DateTime<Utc>) -> String {
    if status == "pending" && expires_at <= now {
        "expired".to_string()
    } else {
        status.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn overdue_pending_is_expired() {
        let now = Utc::now();
        assert_eq!(effective_status("pending", now - Duration::seconds(1), now), "expired");
        assert_eq!(effective_status("pending", now, now), "expired");
    }

    #[test]
    fn future_pending_stays_pending() {
        let now = Utc::now();
        assert_eq!(effective_status("pending", now + Duration::hours(1), now), "pending");
    }

    #[test]
    fn resolved_statuses_are_unchanged() {
        let now = Utc::now();
        for s in ["accepted", "declined", "cancelled", "expired"] {
            assert_eq!(effective_status(s, now - Duration::days(1), now), s);
        }
    }
}
