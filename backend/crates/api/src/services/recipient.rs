//! Recipient resolution for internal transfers.
//!
//! A transfer recipient can be identified by a tag (`@alice`), an email
//! address, or an EVM/Stellar wallet address. This module resolves any of
//! those identifier formats to a canonical [`UserId`].

use sqlx::PgPool;
use thiserror::Error;
use uuid::Uuid;

/// Kind of identifier a saved contact stores.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContactKind {
    /// A platform tag such as `alice` (stored without the leading `@`).
    Tag,
    /// A chain address (EVM or Stellar).
    Address,
}

impl ContactKind {
    /// Parse a contact kind from its textual representation.
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "tag" => Some(ContactKind::Tag),
            "address" | "wallet" => Some(ContactKind::Address),
            _ => None,
        }
    }

    /// Stable textual representation used in the database.
    pub fn as_str(&self) -> &'static str {
        match self {
            ContactKind::Tag => "tag",
            ContactKind::Address => "address",
        }
    }
}

/// A saved contact belonging to a user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Contact {
    /// Contact row identifier.
    pub id: Uuid,
    /// Owner of the contact.
    pub user_id: UserId,
    /// Human-readable label chosen by the owner.
    pub label: String,
    /// Kind of identifier stored in `value`.
    pub kind: ContactKind,
    /// Normalized identifier value.
    pub value: String,
    /// Optional chain hint (e.g. `evm`, `stellar`).
    pub chain: Option<String>,
}

/// Errors that can occur while managing contacts.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ContactError {
    /// The label or value was empty or malformed.
    #[error("contact input is invalid: {0}")]
    Invalid(String),
    /// The contact does not exist or is not owned by the user.
    #[error("contact not found")]
    NotFound,
    /// The underlying database query failed.
    #[error("contact storage failed: {0}")]
    Database(String),
}

/// Risk assessment for a prospective transfer recipient.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RecipientRisk {
    /// No prior successful transfer or saved contact matches the identifier.
    pub first_time: bool,
    /// The identifier closely resembles a saved contact or recent counterparty
    /// but is not an exact match (possible address poisoning).
    pub look_alike: bool,
}

/// Normalize a contact value: tags lose their leading `@`, addresses are
/// lowercased and trimmed.
pub fn normalize_contact_value(kind: ContactKind, value: &str) -> String {
    let trimmed = value.trim();
    match kind {
        ContactKind::Tag => trimmed.trim_start_matches('@').to_string(),
        ContactKind::Address => trimmed.to_ascii_lowercase(),
    }
}

/// Compute the Levenshtein edit distance between two strings.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut curr = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        curr[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = if ca == cb { 0 } else { 1 };
            curr[j + 1] = (prev[j + 1] + 1).min(curr[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut curr);
    }
    prev[b.len()]
}

/// Longest common prefix length between two strings (case-insensitive).
fn common_prefix_len(a: &str, b: &str) -> usize {
    a.chars()
        .zip(b.chars())
        .take_while(|(x, y)| x.eq_ignore_ascii_case(y))
        .count()
}

/// Longest common suffix length between two strings (case-insensitive).
fn common_suffix_len(a: &str, b: &str) -> usize {
    a.chars()
        .rev()
        .zip(b.chars().rev())
        .take_while(|(x, y)| x.eq_ignore_ascii_case(y))
        .count()
}

/// Determine whether `candidate` looks like `known` without being an exact
/// match. Addresses are compared case-insensitively; a small edit distance or
/// a long shared prefix/suffix is treated as suspicious.
pub fn is_look_alike(candidate: &str, known: &str) -> bool {
    let candidate = candidate.trim().to_ascii_lowercase();
    let known = known.trim().to_ascii_lowercase();
    if candidate.is_empty() || known.is_empty() || candidate == known {
        return false;
    }
    let distance = edit_distance(&candidate, &known);
    if distance <= 2 {
        return true;
    }
    let min_len = candidate.chars().count().min(known.chars().count());
    let prefix = common_prefix_len(&candidate, &known);
    let suffix = common_suffix_len(&candidate, &known);
    // A shared prefix or suffix covering most of the shorter string is a
    // classic address-poisoning pattern.
    let threshold = (min_len * 3) / 4;
    threshold >= 4 && (prefix >= threshold || suffix >= threshold)
}

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

/// List all contacts saved by `user_id`, ordered by label.
pub async fn list_contacts(pool: &PgPool, user_id: UserId) -> Result<Vec<Contact>, ContactError> {
    let rows = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, Option<String>)>(
        "SELECT id, user_id, label, kind, value, chain \
         FROM contacts WHERE user_id = $1 ORDER BY label ASC",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|err| ContactError::Database(err.to_string()))?;

    rows.into_iter()
        .map(|(id, user_id, label, kind, value, chain)| {
            let kind = ContactKind::parse(&kind)
                .ok_or_else(|| ContactError::Database(format!("unknown contact kind: {kind}")))?;
            Ok(Contact {
                id,
                user_id,
                label,
                kind,
                value,
                chain,
            })
        })
        .collect()
}

/// Create a new contact for `user_id`.
pub async fn create_contact(
    pool: &PgPool,
    user_id: UserId,
    label: &str,
    kind: ContactKind,
    value: &str,
    chain: Option<&str>,
) -> Result<Contact, ContactError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(ContactError::Invalid("label is empty".to_string()));
    }
    let value = normalize_contact_value(kind, value);
    if value.is_empty() {
        return Err(ContactError::Invalid("value is empty".to_string()));
    }

    let row = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, Option<String>)>(
        "INSERT INTO contacts (user_id, label, kind, value, chain) \
         VALUES ($1, $2, $3, $4, $5) \
         RETURNING id, user_id, label, kind, value, chain",
    )
    .bind(user_id)
    .bind(label)
    .bind(kind.as_str())
    .bind(&value)
    .bind(chain)
    .fetch_one(pool)
    .await
    .map_err(|err| ContactError::Database(err.to_string()))?;

    Ok(Contact {
        id: row.0,
        user_id: row.1,
        label: row.2,
        kind,
        value: row.4,
        chain: row.5,
    })
}

/// Update an existing contact owned by `user_id`.
pub async fn update_contact(
    pool: &PgPool,
    user_id: UserId,
    id: Uuid,
    label: &str,
    kind: ContactKind,
    value: &str,
    chain: Option<&str>,
) -> Result<Contact, ContactError> {
    let label = label.trim();
    if label.is_empty() {
        return Err(ContactError::Invalid("label is empty".to_string()));
    }
    let value = normalize_contact_value(kind, value);
    if value.is_empty() {
        return Err(ContactError::Invalid("value is empty".to_string()));
    }

    let row = sqlx::query_as::<_, (Uuid, Uuid, String, String, String, Option<String>)>(
        "UPDATE contacts SET label = $3, kind = $4, value = $5, chain = $6 \
         WHERE id = $1 AND user_id = $2 \
         RETURNING id, user_id, label, kind, value, chain",
    )
    .bind(id)
    .bind(user_id)
    .bind(label)
    .bind(kind.as_str())
    .bind(&value)
    .bind(chain)
    .fetch_optional(pool)
    .await
    .map_err(|err| ContactError::Database(err.to_string()))?;

    match row {
        Some(row) => Ok(Contact {
            id: row.0,
            user_id: row.1,
            label: row.2,
            kind,
            value: row.4,
            chain: row.5,
        }),
        None => Err(ContactError::NotFound),
    }
}

/// Delete a contact owned by `user_id`.
pub async fn delete_contact(
    pool: &PgPool,
    user_id: UserId,
    id: Uuid,
) -> Result<(), ContactError> {
    let result = sqlx::query("DELETE FROM contacts WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await
        .map_err(|err| ContactError::Database(err.to_string()))?;

    if result.rows_affected() == 0 {
        return Err(ContactError::NotFound);
    }
    Ok(())
}

/// Assess the risk of paying `identifier` for `user_id`.
///
/// `first_time` is set when the identifier matches neither a saved contact nor
/// a prior successful transfer. `look_alike` is set when the identifier is not
/// an exact contact match but closely resembles a saved contact or a recent
/// counterparty.
pub async fn assess_recipient(
    pool: &PgPool,
    user_id: UserId,
    identifier: &str,
) -> Result<RecipientRisk, ContactError> {
    let identifier = identifier.trim();
    if identifier.is_empty() {
        return Err(ContactError::Invalid("identifier is empty".to_string()));
    }

    let kind = if identifier.starts_with('@') || !identifier.contains("0x") {
        ContactKind::Tag
    } else {
        ContactKind::Address
    };
    let normalized = normalize_contact_value(kind, identifier);

    let contacts = list_contacts(pool, user_id).await?;
    let exact_contact = contacts
        .iter()
        .any(|c| c.value.eq_ignore_ascii_case(&normalized));

    let prior_transfer: Option<(i64,)> = sqlx::query_as(
        "SELECT COUNT(*) FROM transfers \
         WHERE sender_id = $1 AND (recipient_identifier = $2 OR recipient_identifier = $3) \
         AND status = 'completed'",
    )
    .bind(user_id)
    .bind(identifier)
    .bind(&normalized)
    .fetch_optional(pool)
    .await
    .map_err(|err| ContactError::Database(err.to_string()))?;

    let has_prior_transfer = prior_transfer.map(|(count,)| count > 0).unwrap_or(false);

    let recent: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT recipient_identifier FROM transfers \
         WHERE sender_id = $1 AND recipient_identifier IS NOT NULL \
         ORDER BY recipient_identifier LIMIT 100",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await
    .map_err(|err| ContactError::Database(err.to_string()))?;

    let look_alike = !exact_contact
        && (contacts
            .iter()
            .any(|c| is_look_alike(&normalized, &c.value))
            || recent
                .iter()
                .any(|(value,)| is_look_alike(&normalized, value)));

    Ok(RecipientRisk {
        first_time: !exact_contact && !has_prior_transfer,
        look_alike,
    })
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

    #[test]
    fn normalizes_tag_and_address_values() {
        assert_eq!(normalize_contact_value(ContactKind::Tag, "  @alice "), "alice");
        assert_eq!(
            normalize_contact_value(ContactKind::Address, "  0xABCDEF  "),
            "0xabcdef"
        );
    }

    #[test]
    fn edit_distance_basics() {
        assert_eq!(edit_distance("kitten", "sitting"), 3);
        assert_eq!(edit_distance("", "abc"), 3);
        assert_eq!(edit_distance("same", "same"), 0);
    }

    #[test]
    fn flags_single_character_address_difference() {
        let known = "0xabc0000000000000000000000000000000001234";
        let candidate = "0xabc0000000000000000000000000000000001235";
        assert!(is_look_alike(candidate, known));
    }

    #[test]
    fn flags_case_insensitive_look_alike() {
        let known = "0xabc0000000000000000000000000000000001234";
        let candidate = "0xABC0000000000000000000000000000000001235";
        assert!(is_look_alike(candidate, known));
    }

    #[test]
    fn flags_shared_long_prefix() {
        let known = "0xdeadbeef00000000000000000000000000000001";
        let candidate = "0xdeadbeef00000000000000000000000000000099";
        assert!(is_look_alike(candidate, known));
    }

    #[test]
    fn does_not_flag_exact_match() {
        let addr = "0xabc0000000000000000000000000000000001234";
        assert!(!is_look_alike(addr, addr));
    }

    #[test]
    fn does_not_flag_unrelated_addresses() {
        let known = "0x1111111111111111111111111111111111111111";
        let candidate = "0x9999999999999999999999999999999999999999";
        assert!(!is_look_alike(candidate, known));
    }

    #[test]
    fn parses_contact_kinds() {
        assert_eq!(ContactKind::parse("tag"), Some(ContactKind::Tag));
        assert_eq!(ContactKind::parse("ADDRESS"), Some(ContactKind::Address));
        assert_eq!(ContactKind::parse("wallet"), Some(ContactKind::Address));
        assert_eq!(ContactKind::parse("bogus"), None);
    }
}
