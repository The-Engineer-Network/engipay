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
    error::ApiError,
    ledger::{LedgerError, LedgerService},
    state::AppState,
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

    let required = payload
        .amount
        .checked_add(payload.estimated_network_fee)
        .ok_or(LedgerError::InvalidAmount)?;

    let available = state
        .ledger
        .available_balance(payload.user_id)
        .await?;

    if available < required {
        return Err(ApiError::from(LedgerError::InsufficientFunds {
            required,
            available,
        }));
    }

    let withdrawal = state
        .ledger
        .create_withdrawal_hold(
            payload.user_id,
            payload.amount,
            payload.estimated_network_fee,
            &payload.destination,
        )
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(WithdrawalResponse {
            id: withdrawal.id,
            user_id: withdrawal.user_id,
            amount: withdrawal.amount,
            estimated_network_fee: withdrawal.estimated_network_fee,
            status: withdrawal.status,
        }),
    ))
}

pub async fn get_withdrawal(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let withdrawal = state.ledger.get_withdrawal(id).await?;
    Ok(Json(WithdrawalResponse {
        id: withdrawal.id,
        user_id: withdrawal.user_id,
        amount: withdrawal.amount,
        estimated_network_fee: withdrawal.estimated_network_fee,
        status: withdrawal.status,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let err = LedgerError::InsufficientFunds { required, available };
        assert_eq!(err.required(), required);
        assert_eq!(err.available(), available);
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
}
