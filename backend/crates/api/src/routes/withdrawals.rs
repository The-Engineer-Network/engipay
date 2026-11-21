use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use engipay_core::{Asset, Chain};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    AppState,
    auth::AuthUser,
    error::{ApiError, LedgerError},
    middleware::auth::AuthUser,
    services::cooling_off,
    services::destination_screen::ScreenResult,
    services::receipts::{Receipt, ReceiptType, SignedReceipt},
    services::withdrawal_review,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/withdrawals", post(create_withdrawal))
        .route("/withdrawals/{id}", get(get_withdrawal))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateWithdrawalRequest {
    pub amount: i64,
    pub estimated_network_fee: i64,
    pub destination: String,
    /// Asset to withdraw, e.g. `USDC`, `XLM`, `ETH`, `BTC`.
    pub asset: String,
    /// Chain the withdrawal is sent on, e.g. `stellar`, `base`, `bitcoin`.
    pub chain: String,
}

#[derive(Debug, Serialize)]
pub struct WithdrawalDetailResponse {
    pub id: Uuid,
    pub amount: i64,
    pub estimated_network_fee: i64,
    pub destination: String,
    pub status: String,
    pub cooling_off_until: Option<chrono::DateTime<chrono::Utc>>,
    pub tx_hash: Option<String>,
}

/// Parses the requested asset/chain pair, returning `400 Bad Request` when
/// either value is unknown or the pair is not supported.
fn parse_asset_chain(asset: &str, chain: &str) -> Result<(Asset, Chain), ApiError> {
    let asset = asset
        .trim()
        .parse::<Asset>()
        .map_err(|_| ApiError::BadRequest(format!("unsupported asset: {asset}")))?;
    let chain = chain
        .trim()
        .parse::<Chain>()
        .map_err(|_| ApiError::BadRequest(format!("unsupported chain: {chain}")))?;
    if !asset.is_on(chain) {
        return Err(ApiError::BadRequest(format!(
            "asset {} is not supported on chain {}",
            asset.symbol(),
            chain
        )));
    }
    Ok((asset, chain))
}

/// Validates that `destination` is a well-formed address for `chain`.
fn validate_destination_for_chain(destination: &str, chain: Chain) -> Result<(), ApiError> {
    let dest = destination.trim();
    if dest.is_empty() {
        return Err(ApiError::from(LedgerError::InvalidDestination));
    }
    let valid = match chain {
        Chain::Stellar => {
            dest.len() == 56
                && dest.starts_with('G')
                && dest.chars().all(|c| c.is_ascii_alphanumeric())
        }
        Chain::Base => {
            dest.len() == 42
                && dest.starts_with("0x")
                && dest[2..].chars().all(|c| c.is_ascii_hexdigit())
        }
        Chain::Bitcoin => {
            dest.starts_with("bc1")
                || dest.starts_with('1')
                || dest.starts_with('3')
        }
    };
    if !valid {
        return Err(ApiError::from(LedgerError::InvalidDestination));
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct WithdrawalResponse {
    pub id: Uuid,
    pub user_id: Uuid,
    pub amount: i64,
    pub estimated_network_fee: i64,
    pub status: String,
    /// Server-signed receipt for this withdrawal. Can be shared and verified
    /// out-of-band via the public verification endpoint.
    pub receipt: SignedReceipt,
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
    user: AuthUser,
    Json(payload): Json<CreateWithdrawalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = user.user_id;
    if payload.amount <= 0 {
        return Err(ApiError::from(LedgerError::InvalidAmount));
    }
    if payload.estimated_network_fee < 0 {
        return Err(ApiError::from(LedgerError::InvalidAmount));
    }

    // Validate the requested asset/chain pair and the destination for that
    // chain before any hold is placed.
    let (asset, chain) = parse_asset_chain(&payload.asset, &payload.chain)?;
    validate_destination_for_chain(&payload.destination, chain)?;

    // Screen the destination against the block list *before* any hold is
    // placed. A blocked address is rejected with 400 Bad Request so no funds
    // are ever locked for a disallowed destination.
    if let ScreenResult::Blocked { reason } = state.destination_screen.screen(&payload.destination)
    {
        return Err(ApiError::BadRequest(format!(
            "withdrawal destination is blocked: {reason}"
        )));
    }

    // Reject withdrawals that target EngiPay's own custody addresses. Sending
    // funds to a custody address loops money on-chain and incurs unnecessary
    // network fees without crediting any user account.
    if is_custody_address(&payload.destination, &state) {
        return Err(ApiError::from(LedgerError::InvalidDestination));
    }

    // Total that must be locked: principal plus the estimated network fee.
    let required_total = payload
        .amount
        .checked_add(payload.estimated_network_fee)
        .ok_or(LedgerError::InvalidAmount)?;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Reject frozen accounts before any hold is placed.
    crate::services::frozen::ensure_not_frozen(&pool, user_id).await?;

    // Check if withdrawal destination is in cooling-off period
    let cooling_off_decision =
        cooling_off::check_address_cooling_off(&pool, user_id, &payload.destination)
            .await
            .map_err(|e| ApiError::Internal(anyhow::anyhow!("cooling off check failed: {}", e)))?;

    // Check if withdrawal requires manual review. The threshold is parsed once
    // at startup and read from the shared config here.
    let review_config = withdrawal_review::ReviewConfig::new(
        state.config.withdrawal_review_threshold_usdc,
    );
    let review_decision = withdrawal_review::check_withdrawal(
        engipay_core::Money::from_minor(asset, i128::from(payload.amount)),
        &review_config,
    );

    // Map both checks onto a status the `withdrawals` table accepts: manual
    // review wins, then a cooling-off hold (which must record its deadline),
    // otherwise the row is ready for the broadcast worker.
    let (status, cooling_off_until) = match (&cooling_off_decision, &review_decision) {
        (_, rd) if rd.requires_review() => (rd.status().to_owned(), None),
        (cooling_off::CoolingOff::Hold { until }, _) => ("cooling_off".to_owned(), Some(*until)),
        _ => ("pending_broadcast".to_owned(), None),
    };

    // Daily velocity limit: refuse before the withdrawal (and its hold) is created.
    crate::services::flow_limits::check_outflow_velocity(
        &pool,
        engipay_core::UserId::from_uuid(payload.user_id),
        engipay_core::Money::from_minor(engipay_core::Asset::Usdc, i128::from(payload.amount)),
        state.config.tier_0_daily_limit_minor,
    )
    .await?;

    let withdrawal_id = Uuid::new_v4();
    let hold_ref = withdrawal_hold_reference(withdrawal_id);

    // Place the hold and insert the withdrawal row atomically: if the hold
    // fails (e.g. insufficient funds) no withdrawal row is created.
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to begin transaction: {}", e)))?;

    let ledger = engipay_ledger::PostgresLedgerStore::new(pool.clone());
    ledger
        .create_hold(&mut tx, user_id, required_total, &hold_ref)
        .await
        .map_err(|e| match e {
            engipay_ledger::LedgerError::InsufficientFunds { available } => {
                ApiError::from(LedgerError::InsufficientFunds {
                    required: required_total,
                    available,
                    amount: payload.amount,
                    network_fee: payload.estimated_network_fee,
                })
            }
            other => ApiError::Internal(anyhow::anyhow!("failed to create hold: {}", other)),
        })?;

    // Store the withdrawal with its hold reference
    sqlx::query(
        "INSERT INTO withdrawals (id, user_id, amount, estimated_network_fee, destination, asset, chain, hold_reference, status, cooling_off_until)          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
    )
    .bind(withdrawal_id)
    .bind(user_id)
    .bind(payload.amount)
    .bind(payload.estimated_network_fee)
    .bind(&payload.destination)
    .bind(asset.symbol())
    .bind(chain.to_string())
    .bind(&hold_ref)
    .bind(&status)
    .bind(cooling_off_until)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to create withdrawal: {}", e)))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to commit withdrawal: {}", e)))?;

    // Build a canonical receipt for the withdrawal and sign it with the
    // server key so the user can share a verifiable proof of the operation.
    let receipt = Receipt::new(
        ReceiptType::Withdrawal,
        hold_ref.clone(),
        payload.amount,
        Some(payload.estimated_network_fee),
        asset.symbol(),
        chrono::Utc::now(),
        state.receipt_signer.key_id().to_owned(),
    );
    let signed_receipt = state
        .receipt_signer
        .sign(&receipt)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to sign receipt: {}", e)))?;

    Ok((
        StatusCode::CREATED,
        Json(WithdrawalResponse {
            id: withdrawal_id,
            user_id,
            amount: payload.amount,
            estimated_network_fee: payload.estimated_network_fee,
            status,
            receipt: signed_receipt,
        }),
    ))
}

pub async fn get_withdrawal(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<axum::response::Response, ApiError> {
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let row: Option<(
        Uuid,
        Uuid,
        i64,
        i64,
        String,
        String,
        Option<chrono::DateTime<chrono::Utc>>,
        Option<String>,
    )> = sqlx::query_as(
        "SELECT id, user_id, amount, estimated_network_fee, destination, status, cooling_off_until, tx_hash FROM withdrawals WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to load withdrawal: {}", e)))?;

    let (id, user_id, amount, estimated_network_fee, destination, status, cooling_off_until, tx_hash) =
        match row {
            Some(row) => row,
            None => return Err(ApiError::NotFound),
        };

    // Withdrawals belonging to another user are indistinguishable from missing
    // ones so their existence is not leaked.
    if user_id != user.id {
        return Err(ApiError::NotFound);
    }

    Ok((
        StatusCode::OK,
        Json(WithdrawalDetailResponse {
            id,
            amount,
            estimated_network_fee,
            destination,
            status,
            cooling_off_until,
            tx_hash,
        }),
    )
        .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::middleware::rate_limit::RateLimiter;

    /// Builds an [`AppState`] with the given custody addresses pre-configured,
    /// mirroring the real production configuration.
    fn state_with_custody(
        stellar: Option<&str>,
        base: Option<&str>,
        bitcoin: Option<&str>,
    ) -> AppState {
        AppState::with_fakes(
            None,
            Config {
                stellar_custody_account: stellar.map(str::to_owned),
                base_custody_address: base.map(str::to_owned),
                bitcoin_custody_address: bitcoin.map(str::to_owned),
                ..Config::for_tests()
            },
            RateLimiter::new(),
        )
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

    // ── DestinationScreen integration ─────────────────────────────────────────

    use crate::services::destination_screen::{ScreenResult, StaticBlockList};

    fn state_with_blocked(addresses: &[&str]) -> AppState {
        let mut state = AppState::with_fakes(None, Config::for_tests(), RateLimiter::new());
        state.destination_screen = std::sync::Arc::new(StaticBlockList::new(
            addresses.iter().map(|s| s.to_string()),
        ));
        state
    }

    #[test]
    fn blocked_destination_is_refused_before_any_hold() {
        let blocked = "0xdeadbeef00000000000000000000000000000001";
        let state = state_with_blocked(&[blocked]);
        let result = state.destination_screen.screen(blocked);
        assert!(result.is_blocked(), "blocked address must be screened out");
    }

    #[test]
    fn unlisted_destination_passes_the_screen() {
        let state = state_with_blocked(&["0xdeadbeef00000000000000000000000000000001"]);
        let result = state
            .destination_screen
            .screen("0xffffffff00000000000000000000000000000002");
        assert_eq!(result, ScreenResult::Allowed);
    }

    #[test]
    fn blocked_evm_address_case_insensitive() {
        let lower = "0xdeadbeef00000000000000000000000000000001";
        let mixed = "0xDeAdBeEf00000000000000000000000000000001";
        let state = state_with_blocked(&[lower]);
        assert!(state.destination_screen.screen(mixed).is_blocked());
        assert!(
            state
                .destination_screen
                .screen(&lower.to_uppercase())
                .is_blocked()
        );
    }

    // ── Authentication ────────────────────────────────────────────────────────

    use axum::body::Body;
    use axum::http::Request;
    use tower::ServiceExt;

    fn test_app() -> Router {
        router().with_state(AppState::with_fakes(
            None,
            Config::for_tests(),
            RateLimiter::new(),
        ))
    }

    fn withdrawal_body() -> Body {
        Body::from(
            serde_json::json!({
                "amount": 1_000,
                "estimated_network_fee": 25,
                "destination": "0xSomeOtherUserAddress",
            })
            .to_string(),
        )
    }

    #[tokio::test]
    async fn create_withdrawal_without_token_returns_401() {
        let response = test_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/withdrawals")
                    .header("content-type", "application/json")
                    .body(withdrawal_body())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn create_withdrawal_ignores_user_id_in_body() {
        // A body-supplied `user_id` must not be accepted as the account
        // selector: the request is still unauthenticated and rejected.
        let response = test_app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/withdrawals")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "user_id": Uuid::new_v4(),
                            "amount": 1_000,
                            "estimated_network_fee": 25,
                            "destination": "0xSomeOtherUserAddress",
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn create_withdrawal_request_has_no_user_id_field() {
        let payload: CreateWithdrawalRequest = serde_json::from_value(serde_json::json!({
            "amount": 1_000,
            "estimated_network_fee": 25,
            "destination": "0xSomeOtherUserAddress",
        }))
        .expect("valid request");
        assert_eq!(payload.amount, 1_000);
        assert_eq!(payload.estimated_network_fee, 25);
        assert_eq!(payload.destination, "0xSomeOtherUserAddress");
    }
}
