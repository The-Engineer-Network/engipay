//! Recipient resolution for internal transfers.
//!
//! A transfer recipient can be identified by a tag (`@alice`), an email
//! address, or an EVM/Stellar wallet address. This module resolves any of
//! those identifier formats to a canonical [`UserId`].

use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

/// Canonical identifier of a user within the platform.
pub type UserId = Uuid;

/// Errors that can occur while resolving a transfer recipient.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum RecipientError {
    /// The provided input was empty or otherwise malformed.
    #[error("recipient identifier is empty")]
    EmptyInput,
    /// The input did not match any known tag, email, or wallet address.
    #[error("recipient not found")]
    NotFound,
    /// The underlying database query failed.
    #[error("recipient lookup failed: {0}")]
    Database(String),
}

/// Resolve a transfer recipient from a tag, email, or wallet address.
///
/// The identifier format is detected from the input:
/// - `@alice` is treated as a tag and looked up in `user_profiles`.
/// - `alice@example.com` is treated as an email and looked up in `user_profiles`.
/// - anything else is treated as an EVM/Stellar wallet address and looked up
///   in `users`.
///
/// Returns [`RecipientError::NotFound`] when no matching user exists.
pub async fn resolve_recipient(pool: &PgPool, input: &str) -> Result<UserId, RecipientError> {
    let input = input.trim();
    if input.is_empty() {
        return Err(RecipientError::EmptyInput);
    }

    let result = if let Some(tag) = input.strip_prefix('@') {
        if tag.is_empty() {
            return Err(RecipientError::EmptyInput);
        }
        sqlx::query_scalar::<_, UserId>(
            "SELECT user_id FROM user_profiles WHERE tag = $1 LIMIT 1",
        )
        .bind(tag)
        .fetch_optional(pool)
        .await
    } else if input.contains('@') {
        sqlx::query_scalar::<_, UserId>(
            "SELECT user_id FROM user_profiles WHERE email = $1 LIMIT 1",
        )
        .bind(input)
        .fetch_optional(pool)
        .await
    } else {
        sqlx::query_scalar::<_, UserId>(
            "SELECT id FROM users WHERE wallet_address = $1 LIMIT 1",
        )
        .bind(input)
        .fetch_optional(pool)
        .await
    };

    match result {
        Ok(Some(user_id)) => Ok(user_id),
        Ok(None) => Err(RecipientError::NotFound),
        Err(err) => Err(RecipientError::Database(err.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The identifier format detection is pure and can be exercised without a
    /// live database by mirroring the branch selection used in
    /// [`resolve_recipient`].
    #[derive(Debug, PartialEq, Eq)]
    enum IdentifierKind {
        Tag(String),
        Email(String),
        Wallet(String),
        Empty,
    }

    fn classify(input: &str) -> IdentifierKind {
        let input = input.trim();
        if input.is_empty() {
            return IdentifierKind::Empty;
        }
        if let Some(tag) = input.strip_prefix('@') {
            if tag.is_empty() {
                return IdentifierKind::Empty;
            }
            return IdentifierKind::Tag(tag.to_string());
        }
        if input.contains('@') {
            return IdentifierKind::Email(input.to_string());
        }
        IdentifierKind::Wallet(input.to_string())
    }

    #[test]
    fn classifies_tag_identifier() {
        assert_eq!(classify("@alice"), IdentifierKind::Tag("alice".to_string()));
        assert_eq!(classify("  @bob  "), IdentifierKind::Tag("bob".to_string()));
    }

    #[test]
    fn classifies_email_identifier() {
        assert_eq!(
            classify("alice@example.com"),
            IdentifierKind::Email("alice@example.com".to_string())
        );
    }

    #[test]
    fn classifies_evm_wallet_identifier() {
        let addr = "0x1234567890abcdef1234567890abcdef12345678";
        assert_eq!(classify(addr), IdentifierKind::Wallet(addr.to_string()));
    }

    #[test]
    fn classifies_stellar_wallet_identifier() {
        let addr = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
        assert_eq!(classify(addr), IdentifierKind::Wallet(addr.to_string()));
    }

    #[test]
    fn rejects_empty_and_bare_at_identifiers() {
        assert_eq!(classify(""), IdentifierKind::Empty);
        assert_eq!(classify("   "), IdentifierKind::Empty);
        assert_eq!(classify("@"), IdentifierKind::Empty);
    }

    #[test]
    fn error_messages_are_stable() {
        assert_eq!(RecipientError::EmptyInput.to_string(), "recipient identifier is empty");
        assert_eq!(RecipientError::NotFound.to_string(), "recipient not found");
    }
}
