use thiserror::Error;

/// Reserved system handles a user may never claim as their own tag.
const RESERVED_TAGS: [&str; 5] = ["admin", "engipay", "support", "system", "help"];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ValidationError {
    #[error("tag must be 3 to 20 characters long, using only letters, numbers, or underscores")]
    InvalidFormat,
    #[error("\"{0}\" is a reserved handle and cannot be used as a tag")]
    ReservedTag(String),
}

/// Validates a user-supplied tag against the naming rules: 3-20 alphanumeric
/// characters or underscores, and not one of the reserved system handles.
/// A leading `@`, if the user included one, is stripped before validation.
pub fn validate_tag(tag: &str) -> Result<(), ValidationError> {
    let tag = tag.strip_prefix('@').unwrap_or(tag);

    let len = tag.chars().count();
    let format_ok =
        (3..=20).contains(&len) && tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !format_ok {
        return Err(ValidationError::InvalidFormat);
    }

    if RESERVED_TAGS
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(tag))
    {
        return Err(ValidationError::ReservedTag(tag.to_string()));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_a_valid_tag() {
        assert!(validate_tag("alice_92").is_ok());
    }

    #[test]
    fn strips_a_leading_at_sign_before_validating() {
        assert!(validate_tag("@alice_92").is_ok());
    }

    #[test]
    fn rejects_a_tag_shorter_than_three_characters() {
        assert_eq!(validate_tag("ab"), Err(ValidationError::InvalidFormat));
    }

    #[test]
    fn rejects_a_tag_longer_than_twenty_characters() {
        assert_eq!(
            validate_tag("a".repeat(21).as_str()),
            Err(ValidationError::InvalidFormat)
        );
    }

    #[test]
    fn rejects_special_characters() {
        assert_eq!(
            validate_tag("alice-92"),
            Err(ValidationError::InvalidFormat)
        );
        assert_eq!(
            validate_tag("alice 92"),
            Err(ValidationError::InvalidFormat)
        );
        assert_eq!(
            validate_tag("alice@92"),
            Err(ValidationError::InvalidFormat)
        );
    }

    #[test]
    fn rejects_reserved_handles_case_insensitively() {
        assert_eq!(
            validate_tag("admin"),
            Err(ValidationError::ReservedTag("admin".to_string()))
        );
        assert_eq!(
            validate_tag("Support"),
            Err(ValidationError::ReservedTag("Support".to_string()))
        );
        assert_eq!(
            validate_tag("@System"),
            Err(ValidationError::ReservedTag("System".to_string()))
        );
    }
}
