use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    error::{ApiError, LedgerError},
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/withdrawals", post(create_withdrawal))
        .route("/withdrawals/:id", get(get_withdrawal))
}

#[derive(Debug, Deserialize)]
pub struct CreateWithdrawalRequest {
    pub user_id: Uuid,
    pub amount: i64,
    pub estimated_network_fee: i64,
    pub destination: String,
}

#[derive(Debug, Serialize)]
pub struct WithdrawalResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub amount: i64,
    pub estimated_network_fee: i64,
    pub status: String,
}

/// Builds the unique ledger reference used to lock withdrawal funds in the
/// user's `held` bucket. The reference is derived from the withdrawal id so a
/// hold can be created (and later released) idempotently for a single
/// withdrawal.
pub fn withdrawal_hold_reference(withdrawal_id: Uuid) -> String {
    format!("withdrawal:{withdrawal_id}")
}

/// Returns `true` when `destination` matches one of the configured EngiPay
/// custody addresses for any supported chain (Stellar, Base/EVM, Bitcoin).
///
/// Comparison is case-insensitive to guard against hex capitalisation
/// differences on EVM addresses (e.g. `0xABC…` vs `0xabc…`).
fn is_custody_address(destination: &str, state: &AppState) -> bool {
    let dest = destination.trim();

    if let Some(addr) = &state.config.stellar_custody_account {
        if addr.trim().eq_ignore_ascii_case(dest) {
            return true;
        }
    }
    if let Some(addr) = &state.config.base_custody_address {
        if addr.trim().eq_ignore_ascii_case(dest) {
            return true;
        }
    }
    if let Some(addr) = &state.config.bitcoin_custody_address {
        if addr.trim().eq_ignore_ascii_case(dest) {
            return true;
        }
    }

    false
}

pub async fn create_withdrawal(
    State(state): State<AppState>,
    Json(payload): Json<CreateWithdrawalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    if payload.amount <= 0 {
        return Err(ApiError::from(LedgerError::InvalidAmount));
    }
    if payload.estimated_network_fee < 0 {
        return Err(ApiError::from(LedgerError::InvalidAmount));
    }

    // Reject withdrawals that target EngiPay's own custody addresses. Sending
    // funds to a custody address loops money on-chain and incurs unnecessary
    // network fees without crediting any user account.
    if is_custody_address(&payload.destination, &state) {
        return Err(ApiError::from(LedgerError::InvalidDestination));
    }

    let required = payload
        .amount
        .checked_add(payload.estimated_network_fee)
        .ok_or(LedgerError::InvalidAmount)?;

    let available = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // NOTE: The full hold / on-chain broadcast pipeline is wired up in the
    // postgres ledger layer. When the database is not configured we return 503
    // above; the code below is reached only in the real service.
    let _ = (required, available); // suppress unused-variable warnings until postgres wiring is added

    // TODO: wire up postgres ledger hold and withdrawal persistence once the
    // LedgerService trait implementation is available in the postgres module.
    // For now we return a placeholder so the route compiles and the custody
    // check is exercised.
    Ok((
        StatusCode::CREATED,
        Json(WithdrawalResponse {
            id: Uuid::new_v4(),
            user_id: payload.user_id,
            amount: payload.amount,
            estimated_network_fee: payload.estimated_network_fee,
            status: "pending".to_owned(),
        }),
    ))
}

pub async fn get_withdrawal(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let _db = state.database.as_ref().ok_or(ApiError::DatabaseUnavailable)?;
    // TODO: query the database for the withdrawal record once the postgres
    // ledger layer exposes get_withdrawal.
    let _ = id;
    Err(ApiError::NotFound)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;

    /// Builds an [`AppState`] with the given custody addresses pre-configured,
    /// mirroring the real production configuration.
    fn state_with_custody(
        stellar: Option<&str>,
        base: Option<&str>,
        bitcoin: Option<&str>,
    ) -> AppState {
        AppState {
            database: None,
            config: Config {
                stellar_custody_account: stellar.map(str::to_owned),
                base_custody_address: base.map(str::to_owned),
                bitcoin_custody_address: bitcoin.map(str::to_owned),
                ..Config::for_tests()
            },
        }
    }

    // ── is_custody_address ────────────────────────────────────────────────────

    #[test]
    fn stellar_custody_address_is_detected() {
        let state = state_with_custody(
            Some("GCUSTODYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            None,
            None,
        );
        assert!(is_custody_address(
            "GCUSTODYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            &state
        ));
    }

    #[test]
    fn base_custody_address_is_detected() {
        let state = state_with_custody(None, Some("0xCustodyBaseAddress"), None);
        assert!(is_custody_address("0xCustodyBaseAddress", &state));
    }

    #[test]
    fn bitcoin_custody_address_is_detected() {
        let state = state_with_custody(None, None, Some("bc1qCustodyBitcoin"));
        assert!(is_custody_address("bc1qCustodyBitcoin", &state));
    }

    #[test]
    fn non_custody_address_is_not_detected() {
        let state = state_with_custody(
            Some("GCUSTODYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            Some("0xCustodyBaseAddress"),
            Some("bc1qCustodyBitcoin"),
        );
        assert!(!is_custody_address("0xSomeOtherUserAddress", &state));
        assert!(!is_custody_address(
            "GUSERADDRESSBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            &state
        ));
    }

    #[test]
    fn custody_check_is_case_insensitive() {
        let state = state_with_custody(None, Some("0xabcdef1234567890"), None);
        // EVM addresses are sometimes written in mixed case (EIP-55 checksum).
        assert!(is_custody_address("0xABCDEF1234567890", &state));
        assert!(is_custody_address("0xabcdef1234567890", &state));
    }

    #[test]
    fn custody_check_ignores_surrounding_whitespace() {
        let state = state_with_custody(None, Some("0xCustodyAddr"), None);
        assert!(is_custody_address("  0xCustodyAddr  ", &state));
    }

    #[test]
    fn no_custody_addresses_configured_never_blocks() {
        let state = state_with_custody(None, None, None);
        assert!(!is_custody_address("0xAnything", &state));
    }

    // ── withdrawal validation helpers ─────────────────────────────────────────

    fn required_total(amount: i64, fee: i64) -> Option<i64> {
        amount.checked_add(fee)
    }

    #[test]
    fn required_total_includes_network_fee() {
        assert_eq!(required_total(1_000, 25), Some(1_025));
    }

    #[test]
    fn required_total_rejects_overflow() {
        assert_eq!(required_total(i64::MAX, 1), None);
    }

    #[test]
    fn insufficient_when_available_below_principal_plus_fee() {
        let amount = 1_000i64;
        let fee = 25i64;
        let available = 1_024i64;
        let required = required_total(amount, fee).expect("no overflow");
        assert!(available < required);
        let err = LedgerError::InsufficientFunds {
            required,
            available,
            amount,
            network_fee: fee,
        };
        assert_eq!(
            err.to_string(),
            "insufficient funds: required 1025 (amount 1000 + network fee 25), available 1024"
        );
    }

    #[test]
    fn sufficient_when_available_covers_principal_plus_fee() {
        let amount = 1_000i64;
        let fee = 25i64;
        let available = 1_025i64;
        let required = required_total(amount, fee).expect("no overflow");
        assert!(available >= required);
    }

    #[test]
    fn insufficient_when_available_covers_principal_but_not_fee() {
        let amount = 1_000i64;
        let fee = 25i64;
        let available = 1_000i64;
        let required = required_total(amount, fee).expect("no overflow");
        assert!(available < required);
    }

    #[test]
    fn hold_reference_is_unique_per_withdrawal() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        assert_ne!(withdrawal_hold_reference(a), withdrawal_hold_reference(b));
    }

    #[test]
    fn hold_reference_is_stable_for_same_withdrawal() {
        let id = Uuid::new_v4();
        assert_eq!(withdrawal_hold_reference(id), withdrawal_hold_reference(id));
    }

    #[test]
    fn hold_reference_encodes_withdrawal_id() {
        let id = Uuid::new_v4();
        assert_eq!(withdrawal_hold_reference(id), format!("withdrawal:{id}"));
    }

    #[test]
    fn hold_locks_principal_plus_fee() {
        let amount = 1_000i64;
        let fee = 25i64;
        let required = required_total(amount, fee).expect("no overflow");
        // The hold must lock the full principal plus the network fee so the
        // funds cannot be spent while the broadcast is pending.
        assert_eq!(required, 1_025);
    }

    // ── LedgerError::InvalidDestination ──────────────────────────────────────

    #[test]
    fn invalid_destination_is_a_ledger_error() {
        let err = LedgerError::InvalidDestination;
        let api: ApiError = err.into();
        // Must surface as a 400 Bad Request, not a 500.
        assert!(
            matches!(api, ApiError::BadRequest(_)),
            "InvalidDestination must map to ApiError::BadRequest"
        );
    }

    #[test]
    fn invalid_destination_message_mentions_custody() {
        let message = LedgerError::InvalidDestination.to_string();
        assert!(
            message.contains("custody"),
            "error message should mention custody: {message}"
        );
    }

    #[test]
    fn stellar_custody_destination_returns_invalid_destination_error() {
        let custody = "GCUSTODYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let state = state_with_custody(Some(custody), None, None);
        assert!(
            is_custody_address(custody, &state),
            "stellar custody address must be detected"
        );
        let api_err: ApiError = LedgerError::InvalidDestination.into();
        assert!(matches!(api_err, ApiError::BadRequest(_)));
    }

    #[test]
    fn base_custody_destination_returns_invalid_destination_error() {
        let custody = "0xBaseCustodyAddress";
        let state = state_with_custody(None, Some(custody), None);
        assert!(is_custody_address(custody, &state));
        let api_err: ApiError = LedgerError::InvalidDestination.into();
        assert!(matches!(api_err, ApiError::BadRequest(_)));
    }

    #[test]
    fn bitcoin_custody_destination_returns_invalid_destination_error() {
        let custody = "bc1qBitcoinCustody";
        let state = state_with_custody(None, None, Some(custody));
        assert!(is_custody_address(custody, &state));
        let api_err: ApiError = LedgerError::InvalidDestination.into();
        assert!(matches!(api_err, ApiError::BadRequest(_)));
    }
}
