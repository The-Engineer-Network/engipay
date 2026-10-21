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

/// A Stellar asset as it appears in Horizon path-finding and path-payment
/// requests: the asset code plus the issuer for everything except native XLM.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StellarAsset {
    /// Native lumens, `XLM`.
    Native,
    /// An issued asset, identified by its 1-12 character code and `G...`
    /// issuer account.
    Issued { code: String, issuer: String },
}

impl StellarAsset {
    /// The Horizon `asset_type` value for this asset.
    pub fn asset_type(&self) -> &'static str {
        match self {
            StellarAsset::Native => "native",
            StellarAsset::Issued { .. } => "credit_alphanum12",
        }
    }

    /// The Horizon `asset_code` value, absent for native XLM.
    pub fn asset_code(&self) -> Option<&str> {
        match self {
            StellarAsset::Native => None,
            StellarAsset::Issued { code, .. } => Some(code),
        }
    }

    /// The Horizon `asset_issuer` value, absent for native XLM.
    pub fn asset_issuer(&self) -> Option<&str> {
        match self {
            StellarAsset::Native => None,
            StellarAsset::Issued { issuer, .. } => Some(issuer),
        }
    }
}

/// Whether the sender fixes the amount leaving their account (strict-send) or
/// the amount the recipient receives (strict-receive).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathPaymentMode {
    StrictSend,
    StrictReceive,
}

/// A quoted cross-asset payment: what leaves the source account, the path of
/// intermediate assets Horizon found, and the amount the destination receives.
///
/// The slippage bound is the worst rate the user agreed to. For a strict-send
/// payment `destination_amount` is the quoted minimum the recipient must get;
/// for a strict-receive payment `source_amount` is the quoted maximum the
/// sender may spend. Either way, a quote outside the bound must be refused
/// rather than submitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PathPayment {
    pub mode: PathPaymentMode,
    pub source_asset: StellarAsset,
    pub destination_asset: StellarAsset,
    /// Intermediate assets, in order, as returned by Horizon.
    pub path: Vec<StellarAsset>,
    /// Amount debited from the source account, in stroops of `source_asset`.
    pub source_amount: i64,
    /// Amount credited to the destination account, in stroops of
    /// `destination_asset`.
    pub destination_amount: i64,
    /// The worst acceptable destination amount (strict-send) or the most
    /// acceptable source amount (strict-receive), in stroops.
    pub slippage_bound: i64,
}

impl PathPayment {
    /// Whether the quoted amounts still satisfy the slippage bound the user
    /// agreed to.
    pub fn within_slippage(&self) -> bool {
        match self.mode {
            PathPaymentMode::StrictSend => self.destination_amount >= self.slippage_bound,
            PathPaymentMode::StrictReceive => self.source_amount <= self.slippage_bound,
        }
    }
}

/// The status of a SEP-31 transaction as reported by the receiving anchor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sep31Status {
    PendingSender,
    PendingStellar,
    PendingReceiver,
    PendingExternal,
    Completed,
    Refunded,
    Expired,
    Error,
}

impl Sep31Status {
    /// Parses the status string from a SEP-31 transaction record.
    pub fn parse(text: &str) -> Option<Sep31Status> {
        Some(match text {
            "pending_sender" => Sep31Status::PendingSender,
            "pending_stellar" => Sep31Status::PendingStellar,
            "pending_receiver" => Sep31Status::PendingReceiver,
            "pending_external" => Sep31Status::PendingExternal,
            "completed" => Sep31Status::Completed,
            "refunded" => Sep31Status::Refunded,
            "expired" => Sep31Status::Expired,
            "error" => Sep31Status::Error,
            _ => return None,
        })
    }

    /// Whether the recipient has been, or will no longer be, credited.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Sep31Status::Completed | Sep31Status::Refunded | Sep31Status::Expired | Sep31Status::Error
        )
    }
}

/// A SEP-31 cross-border payment as the receiving anchor records it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sep31Transaction {
    /// The anchor's transaction id, echoed back to the sending anchor.
    pub id: String,
    pub status: Sep31Status,
    /// Amount received from the sending anchor, in `asset_code` units.
    pub amount_in: String,
    /// Amount to be paid out to the recipient, in the destination asset.
    pub amount_out: String,
    pub asset_code: String,
    /// Identifier of the sending customer at the sending anchor.
    pub sender_id: String,
    /// Identifier of the receiving customer at this anchor.
    pub receiver_id: String,
    /// The Stellar account the incoming payment is sent to.
    pub stellar_account_id: String,
    /// The memo the incoming payment must carry, if any.
    pub stellar_memo: Option<String>,
}

impl Sep31Transaction {
    /// Whether an incoming payment has settled and the recipient can be
    /// credited.
    pub fn is_ready_to_credit(&self) -> bool {
        self.status == Sep31Status::PendingReceiver
    }
}

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

    fn usdc() -> StellarAsset {
        StellarAsset::Issued {
            code: "USDC".to_owned(),
            issuer: account(11),
        }
    }

    fn strict_send(destination_amount: i64, slippage_bound: i64) -> PathPayment {
        PathPayment {
            mode: PathPaymentMode::StrictSend,
            source_asset: StellarAsset::Native,
            destination_asset: usdc(),
            path: vec![],
            source_amount: 10_000_000,
            destination_amount,
            slippage_bound,
        }
    }

    #[test]
    fn a_strict_send_quote_inside_the_bound_is_accepted() {
        assert!(strict_send(9_500_000, 9_000_000).within_slippage());
    }

    #[test]
    fn a_strict_send_quote_below_the_bound_is_refused() {
        assert!(!strict_send(8_000_000, 9_000_000).within_slippage());
    }

    #[test]
    fn a_strict_receive_quote_above_the_bound_is_refused() {
        let payment = PathPayment {
            mode: PathPaymentMode::StrictReceive,
            source_asset: StellarAsset::Native,
            destination_asset: usdc(),
            path: vec![],
            source_amount: 11_000_000,
            destination_amount: 10_000_000,
            slippage_bound: 10_500_000,
        };
        assert!(!payment.within_slippage());
    }

    #[test]
    fn native_assets_have_no_code_or_issuer() {
        assert_eq!(StellarAsset::Native.asset_type(), "native");
        assert_eq!(StellarAsset::Native.asset_code(), None);
        assert_eq!(StellarAsset::Native.asset_issuer(), None);
        assert_eq!(usdc().asset_code(), Some("USDC"));
    }

    #[test]
    fn sep31_statuses_parse_and_report_terminal_states() {
        assert_eq!(
            Sep31Status::parse("pending_receiver"),
            Some(Sep31Status::PendingReceiver)
        );
        assert_eq!(Sep31Status::parse("nonsense"), None);
        assert!(Sep31Status::Completed.is_terminal());
        assert!(!Sep31Status::PendingStellar.is_terminal());
    }

    #[test]
    fn a_sep31_transaction_is_ready_to_credit_only_when_pending_receiver() {
        let mut tx = Sep31Transaction {
            id: "tx-1".to_owned(),
            status: Sep31Status::PendingStellar,
            amount_in: "10.0000000".to_owned(),
            amount_out: "9.9000000".to_owned(),
            asset_code: "USDC".to_owned(),
            sender_id: "sender-1".to_owned(),
            receiver_id: "receiver-1".to_owned(),
            stellar_account_id: account(9),
            stellar_memo: Some("12345".to_owned()),
        };
        assert!(!tx.is_ready_to_credit());
        tx.status = Sep31Status::PendingReceiver;
        assert!(tx.is_ready_to_credit());
    }
}
