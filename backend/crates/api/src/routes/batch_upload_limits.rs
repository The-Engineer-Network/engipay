//! Size and row-count caps for batch payment CSV uploads.
//!
//! Defaults are 1 MiB and 1,000 rows; both can be overridden with the
//! `BATCH_MAX_CSV_BYTES` and `BATCH_MAX_ROWS` environment variables.

use crate::error::ApiError;

/// Default maximum CSV size in bytes (1 MiB).
pub const DEFAULT_MAX_CSV_BYTES: usize = 1024 * 1024;
/// Default maximum number of data rows.
pub const DEFAULT_MAX_ROWS: usize = 1_000;

/// Upload caps for one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadLimits {
    pub max_bytes: usize,
    pub max_rows: usize,
}

impl UploadLimits {
    /// Reads the caps from the environment, falling back to the defaults for
    /// unset, unparsable or zero values.
    pub fn from_env() -> Self {
        let read = |key: &str, default: usize| {
            std::env::var(key)
                .ok()
                .and_then(|v| v.trim().parse::<usize>().ok())
                .filter(|v| *v > 0)
                .unwrap_or(default)
        };
        Self {
            max_bytes: read("BATCH_MAX_CSV_BYTES", DEFAULT_MAX_CSV_BYTES),
            max_rows: read("BATCH_MAX_ROWS", DEFAULT_MAX_ROWS),
        }
    }

    /// Rejects an oversized file by byte length alone.
    pub fn check_size(&self, len: usize) -> Result<(), ApiError> {
        if len > self.max_bytes {
            return Err(ApiError::BadRequest(format!(
                "CSV exceeds maximum size of {} bytes",
                self.max_bytes
            )));
        }
        Ok(())
    }

    /// Rejects a file with too many data rows by counting lines, before any
    /// row is parsed. The header line is not counted.
    pub fn check_rows(&self, csv: &[u8]) -> Result<(), ApiError> {
        let lines = csv
            .split(|b| *b == b'\n')
            .filter(|l| !l.iter().all(u8::is_ascii_whitespace))
            .count();
        if lines.saturating_sub(1) > self.max_rows {
            return Err(ApiError::BadRequest(format!(
                "CSV exceeds maximum of {} rows",
                self.max_rows
            )));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIMITS: UploadLimits = UploadLimits { max_bytes: 100, max_rows: 3 };

    #[test]
    fn size_at_limit_ok_over_limit_refused() {
        assert!(LIMITS.check_size(100).is_ok());
        assert!(LIMITS.check_size(101).is_err());
    }

    #[test]
    fn row_count_excludes_header_and_blank_lines() {
        assert!(LIMITS.check_rows(b"h\na\nb\nc\n\n").is_ok());
        assert!(LIMITS.check_rows(b"h\na\nb\nc\nd\n").is_err());
    }

    #[test]
    fn defaults_are_one_mib_and_a_thousand_rows() {
        assert_eq!(DEFAULT_MAX_CSV_BYTES, 1_048_576);
        assert_eq!(DEFAULT_MAX_ROWS, 1_000);
    }
}
