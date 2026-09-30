//! SEP-23 muxed-address derivation service.
//!
//! Each EngiPay user on Stellar receives a unique `M...` muxed address derived
//! from the single shared custody account (`G...`) and a 64-bit user sequence
//! ID.  This module is the service layer that:
//!
//! 1. Validates the master account string before attempting derivation.
//! 2. Calls [`engipay_core::stellar::muxed_deposit_address`] — the canonical
//!    derivation helper — with the master account and the user's sequence ID.
//! 3. Returns the `M...` address as an owned [`String`].
//!
//! # What this module does NOT do
//!
//! It does **not** choose or persist the user sequence ID.  That responsibility
//! belongs to the deposit-address provisioning path (`routes/deposits.rs`),
//! which derives the ID from the lower 64 bits of the user's UUID and writes a
//! `deposit_addresses` row.  This service only performs the derivation step.
//!
//! # Relationship to `engipay_core::stellar`
//!
//! [`engipay_core::stellar::muxed_deposit_address`] holds the ground truth for
//! how an `M...` address is constructed (using `stellar-strkey`, the SDF's own
//! library).  This module wraps it with API-friendly error types and the
//! validation that belongs at the service boundary.

use engipay_core::stellar::{StellarAddressError, muxed_deposit_address};

use crate::error::ApiError;

// ── Public API ────────────────────────────────────────────────────────────────

/// Derives the SEP-23 muxed deposit address for a user.
///
/// Combines `master_account` (a plain `G...` Stellar account) with
/// `user_seq_id` (a 64-bit user-specific index) to produce a unique
/// `M...` muxed account string.
///
/// The derivation is performed by [`engipay_core::stellar::muxed_deposit_address`],
/// which uses the `stellar-strkey` library maintained by the Stellar
/// Development Foundation.  The same address is always produced for the same
/// `(master_account, user_seq_id)` pair — callers are responsible for storing
/// the ID so it can be looked up later.
///
/// # Errors
///
/// Returns [`ApiError::BadRequest`] when:
/// - `master_account` is not a valid `G...` Stellar public key (e.g. it is
///   already an `M...` muxed address, a secret key, a contract address, or
///   random garbage).
///
/// # Example
///
/// ```rust,ignore
/// let address = derive_stellar_muxed_address("GABC…", 42_000)?;
/// assert!(address.starts_with('M'));
/// ```
pub fn derive_stellar_muxed_address(
    master_account: &str,
    user_seq_id: u64,
) -> Result<String, ApiError> {
    muxed_deposit_address(master_account, user_seq_id).map_err(map_stellar_error)
}

// ── Error mapping ─────────────────────────────────────────────────────────────

fn map_stellar_error(error: StellarAddressError) -> ApiError {
    match error {
        // A muxed address was passed as the master — clear user-facing message.
        StellarAddressError::NotAnAccount => ApiError::BadRequest(
            "master_account must be a plain G... Stellar account, not an M... muxed address"
                .to_owned(),
        ),
        // Secret key pasted by mistake — say so explicitly.
        StellarAddressError::SecretKey => ApiError::BadRequest(
            "master_account is a Stellar secret key; never share it — use a G... public key"
                .to_owned(),
        ),
        // Any other strkey parse failure.
        StellarAddressError::Invalid => ApiError::BadRequest(
            "master_account is not a valid Stellar account address".to_owned(),
        ),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use engipay_core::stellar::{StellarAddress, parse_address};
    use stellar_strkey::ed25519;

    use super::*;

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// Builds a deterministic `G...` account from a single seed byte so tests
    /// never depend on an address copied from somewhere else.  Uses
    /// `stellar-strkey` exactly as the core crate's own tests do.
    fn account(seed: u8) -> String {
        ed25519::PublicKey([seed; 32])
            .to_string()
            .as_str()
            .to_owned()
    }

    // ── Happy-path tests ──────────────────────────────────────────────────────

    #[test]
    fn derives_a_muxed_address_starting_with_m() {
        let master = account(1);
        let address = derive_stellar_muxed_address(&master, 0).unwrap();
        assert!(
            address.starts_with('M'),
            "muxed address must start with M, got: {address}"
        );
    }

    #[test]
    fn derived_address_round_trips_back_to_master_and_user_id() {
        let master = account(2);
        let user_seq_id = 42_000u64;

        let muxed = derive_stellar_muxed_address(&master, user_seq_id).unwrap();

        let parsed = parse_address(&muxed).unwrap();
        match parsed {
            StellarAddress::Muxed { base, id } => {
                assert_eq!(base, master, "base account must match the custody account");
                assert_eq!(id, user_seq_id, "embedded id must match the user sequence id");
            }
            StellarAddress::Account(_) => {
                panic!("expected a Muxed address, got a plain Account");
            }
        }
    }

    #[test]
    fn different_seq_ids_produce_different_addresses() {
        let master = account(3);
        let addr_a = derive_stellar_muxed_address(&master, 1).unwrap();
        let addr_b = derive_stellar_muxed_address(&master, 2).unwrap();
        assert_ne!(
            addr_a, addr_b,
            "distinct sequence IDs must yield distinct muxed addresses"
        );
    }

    #[test]
    fn same_seq_id_always_produces_the_same_address() {
        let master = account(4);
        let first = derive_stellar_muxed_address(&master, 99).unwrap();
        let second = derive_stellar_muxed_address(&master, 99).unwrap();
        assert_eq!(first, second, "derivation must be deterministic");
    }

    #[test]
    fn seq_id_zero_is_valid() {
        let master = account(5);
        let address = derive_stellar_muxed_address(&master, 0).unwrap();
        assert!(address.starts_with('M'));
    }

    #[test]
    fn seq_id_max_u64_is_valid() {
        let master = account(6);
        let address = derive_stellar_muxed_address(&master, u64::MAX).unwrap();
        assert!(address.starts_with('M'));

        // Round-trip: u64::MAX must survive through the strkey encoding.
        let parsed = parse_address(&address).unwrap();
        assert!(
            matches!(parsed, StellarAddress::Muxed { id, .. } if id == u64::MAX),
            "u64::MAX must survive the round-trip"
        );
    }

    #[test]
    fn different_master_accounts_produce_different_muxed_addresses() {
        let master_a = account(10);
        let master_b = account(11);
        let addr_a = derive_stellar_muxed_address(&master_a, 1).unwrap();
        let addr_b = derive_stellar_muxed_address(&master_b, 1).unwrap();
        assert_ne!(
            addr_a, addr_b,
            "the same seq_id on different masters must produce different addresses"
        );
    }

    #[test]
    fn base_account_of_muxed_address_matches_master() {
        let master = account(7);
        let muxed = derive_stellar_muxed_address(&master, 7).unwrap();
        let parsed = parse_address(&muxed).unwrap();
        assert_eq!(
            parsed.base_account(),
            master,
            "base_account() must return the original G... custody account"
        );
    }

    #[test]
    fn muxed_address_is_longer_than_a_plain_account() {
        // G... addresses are 56 characters; M... addresses are longer.
        let master = account(8);
        let address = derive_stellar_muxed_address(&master, 1).unwrap();
        assert!(
            address.len() > 56,
            "muxed address must be longer than a plain G... address (56 chars), got {} chars",
            address.len()
        );
    }

    #[test]
    fn seq_id_is_recoverable_from_muxed_address() {
        // Verify that a caller can recover the original seq_id purely from the
        // muxed address, without any side-channel storage.
        let master = account(12);
        let seq_id = 123_456_789u64;
        let muxed = derive_stellar_muxed_address(&master, seq_id).unwrap();

        let StellarAddress::Muxed { id, .. } = parse_address(&muxed).unwrap() else {
            panic!("expected Muxed");
        };
        assert_eq!(id, seq_id);
    }

    #[test]
    fn leading_and_trailing_whitespace_in_master_is_tolerated() {
        // The core `parse_address` trims whitespace; we verify that property
        // is preserved through this service layer.
        let master = account(13);
        let padded = format!("  {master}  ");
        let with_whitespace = derive_stellar_muxed_address(&padded, 1).unwrap();
        let without_whitespace = derive_stellar_muxed_address(&master, 1).unwrap();
        assert_eq!(
            with_whitespace, without_whitespace,
            "surrounding whitespace on master_account must be ignored"
        );
    }

    // ── Error-path tests ──────────────────────────────────────────────────────

    #[test]
    fn rejects_a_muxed_address_as_master() {
        // Passing an M... as the master account is a programming error.
        let master = account(9);
        let muxed = derive_stellar_muxed_address(&master, 1).unwrap();

        let result = derive_stellar_muxed_address(&muxed, 2);
        assert!(
            matches!(result, Err(ApiError::BadRequest(_))),
            "muxed address as master must return BadRequest"
        );
    }

    #[test]
    fn rejects_a_secret_key_as_master() {
        let secret = ed25519::PrivateKey([3u8; 32])
            .as_unredacted()
            .to_string()
            .as_str()
            .to_owned();

        let result = derive_stellar_muxed_address(&secret, 0);
        assert!(
            matches!(result, Err(ApiError::BadRequest(ref msg)) if msg.contains("secret key")),
            "secret key must be rejected with a message mentioning 'secret key'"
        );
    }

    #[test]
    fn rejects_an_empty_string() {
        let result = derive_stellar_muxed_address("", 0);
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_an_evm_address() {
        let result = derive_stellar_muxed_address(
            "0x1234567890abcdef1234567890abcdef12345678",
            0,
        );
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_a_bitcoin_address() {
        let result =
            derive_stellar_muxed_address("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", 0);
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_a_contract_address() {
        let contract = stellar_strkey::Contract([5u8; 32])
            .to_string()
            .as_str()
            .to_owned();
        let result = derive_stellar_muxed_address(&contract, 0);
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_whitespace_only() {
        let result = derive_stellar_muxed_address("   ", 0);
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_a_truncated_address() {
        // A G... address with characters removed fails the strkey checksum.
        let truncated = &account(7)[..30];
        let result = derive_stellar_muxed_address(truncated, 0);
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    #[test]
    fn rejects_a_tampered_address() {
        // Flip one character — the strkey checksum must catch it.
        let master = account(7);
        let mut chars: Vec<char> = master.chars().collect();
        chars[20] = if chars[20] == 'A' { 'B' } else { 'A' };
        let tampered: String = chars.into_iter().collect();

        let result = derive_stellar_muxed_address(&tampered, 0);
        assert!(matches!(result, Err(ApiError::BadRequest(_))));
    }

    // ── Error message quality tests ───────────────────────────────────────────

    #[test]
    fn bad_request_message_for_muxed_input_mentions_g_address() {
        let master = account(9);
        let muxed = derive_stellar_muxed_address(&master, 1).unwrap();
        let Err(ApiError::BadRequest(msg)) = derive_stellar_muxed_address(&muxed, 2) else {
            panic!("expected BadRequest");
        };
        assert!(
            msg.contains("G..."),
            "error message should mention G... format, got: {msg}"
        );
    }

    #[test]
    fn bad_request_message_is_non_empty_for_invalid_input() {
        let Err(ApiError::BadRequest(msg)) = derive_stellar_muxed_address("garbage", 0) else {
            panic!("expected BadRequest");
        };
        assert!(!msg.is_empty(), "error message must not be empty");
    }
}
