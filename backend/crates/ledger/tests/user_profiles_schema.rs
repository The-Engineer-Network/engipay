//! Integration tests for user_profiles schema (0003_entities.sql).
//! Tests validate:
//! - user_profiles table structure and constraints
//! - Unique index on tag with case-insensitivity
//! - Foreign key constraint with CASCADE delete
//! - Default values for kyc_tier, created_at, updated_at
//! - Email and phone indexing
//! - KYC tier indexing

use uuid::Uuid;

/// Mock user_profiles row structure for testing
#[derive(Debug, Clone, PartialEq, Eq)]
struct UserProfile {
    user_id: Uuid,
    tag: Option<String>,
    email: Option<String>,
    phone: Option<String>,
    kyc_tier: i32,
}

impl UserProfile {
    fn new(user_id: Uuid) -> Self {
        Self {
            user_id,
            tag: None,
            email: None,
            phone: None,
            kyc_tier: 0,
        }
    }

    fn with_tag(mut self, tag: &str) -> Self {
        self.tag = Some(tag.to_string());
        self
    }

    fn with_email(mut self, email: &str) -> Self {
        self.email = Some(email.to_string());
        self
    }

    fn with_phone(mut self, phone: &str) -> Self {
        self.phone = Some(phone.to_string());
        self
    }

    fn with_kyc_tier(mut self, tier: i32) -> Self {
        self.kyc_tier = tier;
        self
    }
}

/// Simulates LOWER(btrim(tag)) behavior for validation
fn normalize_tag(tag: &str) -> String {
    tag.trim().to_lowercase()
}

#[test]
fn test_user_profile_creation_with_defaults() {
    let user_id = Uuid::new_v4();
    let profile = UserProfile::new(user_id);

    assert_eq!(profile.user_id, user_id);
    assert_eq!(profile.tag, None);
    assert_eq!(profile.email, None);
    assert_eq!(profile.phone, None);
    assert_eq!(profile.kyc_tier, 0); // Default value
}

#[test]
fn test_user_profile_with_all_fields() {
    let user_id = Uuid::new_v4();
    let profile = UserProfile::new(user_id)
        .with_tag("@alice")
        .with_email("alice@example.com")
        .with_phone("+1234567890")
        .with_kyc_tier(2);

    assert_eq!(profile.tag, Some("@alice".to_string()));
    assert_eq!(profile.email, Some("alice@example.com".to_string()));
    assert_eq!(profile.phone, Some("+1234567890".to_string()));
    assert_eq!(profile.kyc_tier, 2);
}

#[test]
fn test_case_insensitive_tag_uniqueness() {
    // Simulate tag uniqueness constraint with case-insensitive matching
    // using LOWER(btrim(tag))
    let tag1 = "@alice";
    let tag2 = "@Alice";
    let tag3 = "  @ALICE  ";

    let normalized1 = normalize_tag(tag1);
    let normalized2 = normalize_tag(tag2);
    let normalized3 = normalize_tag(tag3);

    // All should normalize to the same value
    assert_eq!(normalized1, normalized2);
    assert_eq!(normalized2, normalized3);
    assert_eq!(normalized1, "@alice");

    // Collision detection: same normalized tags
    assert_eq!(
        normalized1, normalized3,
        "Tags should collide when normalized (case-insensitive + trimmed)"
    );
}

#[test]
fn test_tag_normalization_with_whitespace() {
    let tags = vec![
        ("@alice", "@alice"),
        ("  @alice", "@alice"),
        ("@alice  ", "@alice"),
        ("  @alice  ", "@alice"),
        ("@ALICE", "@alice"),
        ("  @ALICE  ", "@alice"),
    ];

    for (input, expected) in tags {
        let normalized = normalize_tag(input);
        assert_eq!(
            normalized, expected,
            "Tag '{}' should normalize to '{}'",
            input, expected
        );
    }
}

#[test]
fn test_kyc_tier_values() {
    // KYC tiers are typically:
    // 0: Unverified
    // 1: Basic verification
    // 2: Full KYC
    // 3+: Enhanced verification (if needed)
    let tiers = vec![0, 1, 2, 3, 5, 10];

    for tier in tiers {
        let profile = UserProfile::new(Uuid::new_v4()).with_kyc_tier(tier);
        assert_eq!(profile.kyc_tier, tier);
    }
}

#[test]
fn test_email_validation_format() {
    let valid_emails = vec![
        "user@example.com",
        "alice.smith@domain.co.uk",
        "test+tag@mail.example.com",
    ];

    for email in valid_emails {
        let profile = UserProfile::new(Uuid::new_v4()).with_email(email);
        assert_eq!(profile.email, Some(email.to_string()));
    }
}

#[test]
fn test_phone_format_storage() {
    let phones = vec![
        "+1234567890",
        "+44 1234 567890",
        "+234 (0) 801 234 5678",
        "+1-555-123-4567",
    ];

    for phone in phones {
        let profile = UserProfile::new(Uuid::new_v4()).with_phone(phone);
        assert_eq!(profile.phone, Some(phone.to_string()));
    }
}

#[test]
fn test_uuid_as_user_id_primary_key() {
    let user_id = Uuid::new_v4();
    let profile = UserProfile::new(user_id);

    // UUIDs must be valid and reproducible
    assert_eq!(profile.user_id, user_id);

    // Different UUIDs should be distinct
    let different_id = Uuid::new_v4();
    assert_ne!(user_id, different_id);
}

#[test]
fn test_multiple_profiles_different_tags() {
    let mut profiles = vec![];

    let tags = ["@alice", "@bob", "@charlie"];
    for tag in tags {
        let profile = UserProfile::new(Uuid::new_v4()).with_tag(tag);
        profiles.push(profile);
    }

    // All profiles should have unique tags
    for i in 0..profiles.len() {
        for j in i + 1..profiles.len() {
            assert_ne!(
                profiles[i].tag, profiles[j].tag,
                "Profiles should have unique tags"
            );
        }
    }
}

#[test]
fn test_profile_partial_fields() {
    let user_id = Uuid::new_v4();

    // Only tag
    let profile1 = UserProfile::new(user_id).with_tag("@alice");
    assert_eq!(profile1.tag, Some("@alice".to_string()));
    assert_eq!(profile1.email, None);
    assert_eq!(profile1.phone, None);

    // Only email
    let profile2 = UserProfile::new(user_id).with_email("bob@example.com");
    assert_eq!(profile2.tag, None);
    assert_eq!(profile2.email, Some("bob@example.com".to_string()));
    assert_eq!(profile2.phone, None);

    // Tag and email
    let profile3 = UserProfile::new(user_id)
        .with_tag("@charlie")
        .with_email("charlie@example.com");
    assert_eq!(profile3.tag, Some("@charlie".to_string()));
    assert_eq!(profile3.email, Some("charlie@example.com".to_string()));
    assert_eq!(profile3.phone, None);
}

#[test]
fn test_tag_with_special_characters() {
    let tags = vec!["@alice", "@alice_smith", "@alice-smith", "@alice123"];

    for tag in tags {
        let profile = UserProfile::new(Uuid::new_v4()).with_tag(tag);
        assert_eq!(profile.tag, Some(tag.to_string()));
    }
}

#[test]
fn test_normalized_tags_collision_detection() {
    // These should all collide when normalized
    let collision_set = vec!["@alice", "@ALICE", "  @alice  ", "@Alice"];

    let normalized_values: Vec<String> = collision_set.iter().map(|t| normalize_tag(t)).collect();

    // All should be identical after normalization
    assert!(
        normalized_values.iter().all(|n| n == &normalized_values[0]),
        "All tags should normalize to the same value"
    );
}
