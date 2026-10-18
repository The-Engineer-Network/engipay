//! Stellar addresses.
//!
//! Parsing uses `stellar-strkey`, maintained by the Stellar Development
//! Foundation, rather than a hand-written base32 and checksum: the rules that
//! decide where money goes should be the network's own.
//!
//! EngiPay receives Stellar deposits on muxed accounts (SEP-23). One custody
//! account gets a distinct `M...` address per user, so a deposit is credited
//! to the right person without relying on the sender remembering a memo.

use stellar_strkey::{Strkey, ed25519};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StellarAddress {
    /// A plain account, `G...`.
    Account(String),
    /// A muxed account, `M...`: a base account plus a 64-bit id.
    Muxed { base: String, id: u64 },
}

impl StellarAddress {
    /// The underlying `G...` account the funds actually move on.
    pub fn base_account(&self) -> &str {
        match self {
            StellarAddress::Account(account) => account,
            StellarAddress::Muxed { base, .. } => base,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum StellarAddressError {
    #[error("not a valid Stellar address")]
    Invalid,
    /// Someone pasted a secret key where an address belongs. Say so plainly:
    /// they should move their funds, because that key is now exposed.
    #[error("this is a Stellar secret key, not an address; never share it")]
    SecretKey,
    #[error("this is a valid Stellar key, but not an account address")]
    NotAnAccount,
}

/// Parses a Stellar account address, `G...` or `M...`.
pub fn parse_address(input: &str) -> Result<StellarAddress, StellarAddressError> {
    match Strkey::from_string(input.trim()) {
        Ok(Strkey::PublicKeyEd25519(key)) => {
            Ok(StellarAddress::Account(owned(key.to_string().as_str())))
        }
        Ok(Strkey::MuxedAccountEd25519(muxed)) => Ok(StellarAddress::Muxed {
            base: owned(ed25519::PublicKey(muxed.ed25519).to_string().as_str()),
            id: muxed.id,
        }),
        Ok(_) => Err(StellarAddressError::NotAnAccount),
        // Secret keys are not part of the general strkey enum, so check for one
        // explicitly. The parsed key is zeroized when it is dropped.
        Err(_) if ed25519::PrivateKey::from_string(input.trim()).is_ok() => {
            Err(StellarAddressError::SecretKey)
        }
        Err(_) => Err(StellarAddressError::Invalid),
    }
}

/// Builds the per-user deposit address: the custody account muxed with the
/// user's numeric deposit id.
pub fn muxed_deposit_address(base_account: &str, id: u64) -> Result<String, StellarAddressError> {
    match parse_address(base_account)? {
        StellarAddress::Account(_) => {}
        StellarAddress::Muxed { .. } => return Err(StellarAddressError::NotAnAccount),
    }
    let key = ed25519::PublicKey::from_string(base_account.trim())
        .map_err(|_| StellarAddressError::Invalid)?;
    Ok(owned(
        ed25519::MuxedAccount { ed25519: key.0, id }
            .to_string()
            .as_str(),
    ))
}

/// The muxed id for a user: the lower 8 bytes of their UUID, big-endian.
///
/// This is the single definition of how a user maps onto a muxed account id.
/// Both the deposit route and the wallet-creation route call
/// [`derive_deposit_address`], so the rule cannot drift between them.
pub fn muxed_id_from_uuid(user_id: Uuid) -> u64 {
    let bytes = user_id.as_bytes();
    u64::from_be_bytes([
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15],
    ])
}

/// Derives the per-user deposit address for a custody account.
///
/// The custody account must be a plain `G...` account; the result is the
/// `M...` address that credits deposits to `user_id`.
pub fn derive_deposit_address(
    custody_account: &str,
    user_id: Uuid,
) -> Result<String, StellarAddressError> {
    muxed_deposit_address(custody_account, muxed_id_from_uuid(user_id))
}

/// stellar-strkey encodes into fixed-size, allocation-free strings; the rest of
/// EngiPay uses ordinary owned strings.
fn owned(text: &str) -> String {
    text.to_owned()
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    /// A deterministic account built from fixed key bytes, so the tests never
    /// depend on an address copied from somewhere else.
    fn account(seed: u8) -> String {
        owned(ed25519::PublicKey([seed; 32]).to_string().as_str())
    }

    #[test]
    fn parses_a_plain_account() {
        let address = account(7);
        assert!(address.starts_with('G'));
        assert_eq!(address.len(), 56);
        assert_eq!(
            parse_address(&address),
            Ok(StellarAddress::Account(address.clone()))
        );
    }

    #[test]
    fn trims_surrounding_whitespace() {
        let address = account(7);
        assert!(parse_address(&format!("  {address}\n")).is_ok());
    }

    #[test]
    fn muxed_deposit_addresses_round_trip_to_the_user() {
        let custody = account(9);
        let deposit = muxed_deposit_address(&custody, 42_000).unwrap();
        assert!(deposit.starts_with('M'));
        assert_eq!(
            parse_address(&deposit),
            Ok(StellarAddress::Muxed {
                base: custody.clone(),
                id: 42_000
            })
        );
        assert_eq!(parse_address(&deposit).unwrap().base_account(), custody);
    }

    #[test]
    fn different_users_get_different_deposit_addresses() {
        let custody = account(9);
        assert_ne!(
            muxed_deposit_address(&custody, 1).unwrap(),
            muxed_deposit_address(&custody, 2).unwrap()
        );
    }

    #[test]
    fn a_secret_key_is_refused_by_name() {
        // Secret keys only render through an explicit Unredacted wrapper.
        let key = ed25519::PrivateKey([3; 32]);
        let secret = owned(key.as_unredacted().to_string().as_str());
        assert!(secret.starts_with('S'));
        assert_eq!(parse_address(&secret), Err(StellarAddressError::SecretKey));
    }

    #[test]
    fn a_contract_address_is_not_an_account() {
        let contract = owned(stellar_strkey::Contract([5; 32]).to_string().as_str());
        assert!(contract.starts_with('C'));
        assert_eq!(
            parse_address(&contract),
            Err(StellarAddressError::NotAnAccount)
        );
    }

    #[test]
    fn a_single_changed_character_fails_the_checksum() {
        let address = account(7);
        let mut chars: Vec<char> = address.chars().collect();
        chars[20] = if chars[20] == 'A' { 'B' } else { 'A' };
        let tampered: String = chars.into_iter().collect();
        assert_eq!(parse_address(&tampered), Err(StellarAddressError::Invalid));
    }

    #[test]
    fn rejects_evm_and_bitcoin_addresses_and_junk() {
        for bad in [
            "",
            "0x1234567890abcdef1234567890abcdef12345678",
            "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            "GABC",
            "not an address",
        ] {
            assert_eq!(
                parse_address(bad),
                Err(StellarAddressError::Invalid),
                "{bad:?}"
            );
        }
    }

    #[test]
    fn lowercase_is_not_accepted() {
        assert_eq!(
            parse_address(&account(7).to_lowercase()),
            Err(StellarAddressError::Invalid)
        );
    }

    #[test]
    fn a_muxed_address_cannot_be_used_as_custody() {
        let custody = account(9);
        let deposit = muxed_deposit_address(&custody, 1).unwrap();
        assert_eq!(
            muxed_deposit_address(&deposit, 2),
            Err(StellarAddressError::NotAnAccount)
        );
    }

    #[test]
    fn muxed_id_uses_the_lower_eight_uuid_bytes_big_endian() {
        let user = Uuid::from_bytes([
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f,
        ]);
        assert_eq!(muxed_id_from_uuid(user), 0x0809_0a0b_0c0d_0e0f);
    }

    #[test]
    fn deposit_address_is_deterministic_for_a_user() {
        let custody = account(9);
        let user = Uuid::from_u128(0x1234_5678_9abc_def0_1122_3344_5566_7788);
        let first = derive_deposit_address(&custody, user).unwrap();
        let second = derive_deposit_address(&custody, user).unwrap();
        assert_eq!(first, second);
        assert!(first.starts_with('M'));
        assert_eq!(
            parse_address(&first),
            Ok(StellarAddress::Muxed {
                base: custody.clone(),
                id: muxed_id_from_uuid(user),
            })
        );
    }

    #[test]
    fn deposit_address_matches_the_muxed_encoding() {
        let custody = account(9);
        let user = Uuid::from_u128(0xdead_beef_cafe_f00d_0123_4567_89ab_cdef);
        assert_eq!(
            derive_deposit_address(&custody, user).unwrap(),
            muxed_deposit_address(&custody, muxed_id_from_uuid(user)).unwrap()
        );
    }

    #[test]
    fn different_users_get_different_deposit_addresses_from_uuid() {
        let custody = account(9);
        let a = derive_deposit_address(&custody, Uuid::from_u128(1)).unwrap();
        let b = derive_deposit_address(&custody, Uuid::from_u128(2)).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn deposit_address_refuses_muxed_custody() {
        let custody = account(9);
        let deposit = muxed_deposit_address(&custody, 1).unwrap();
        assert_eq!(
            derive_deposit_address(&deposit, Uuid::from_u128(1)),
            Err(StellarAddressError::NotAnAccount)
        );
    }
}
