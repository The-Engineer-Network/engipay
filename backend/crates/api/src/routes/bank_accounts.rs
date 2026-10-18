//! Payout bank accounts: the Nigerian accounts that receive Naira from sales.
//!
//! An account is only saved once the payout partner has confirmed its name
//! (the `account_name` column is required). That lookup is not connected yet,
//! so adding an account returns 503. Listing and removing work on accounts
//! that already exist.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/bank-accounts", get(list_accounts).post(add_account))
        .route("/bank-accounts/{id}", delete(remove_account))
}

// ── Validation ────────────────────────────────────────────────────────────────

/// A CBN bank code: 3 to 6 digits.
pub fn validate_bank_code(code: &str) -> Result<(), ApiError> {
    let ok = (3..=6).contains(&code.len()) && code.chars().all(|c| c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Bank code must be 3 to 6 digits.".to_string(),
        ))
    }
}

/// A NUBAN account number: exactly 10 digits.
pub fn validate_account_number(number: &str) -> Result<(), ApiError> {
    if number.len() == 10 && number.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(ApiError::BadRequest(
            "Account number must be exactly 10 digits.".to_string(),
        ))
    }
}

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct AddAccountRequest {
    pub bank_code: String,
    pub account_number: String,
}

/// An account as the owner sees it. The number is masked to its last four digits.
#[derive(Debug, Serialize)]
pub struct BankAccountResponse {
    pub id: Uuid,
    pub bank_code: String,
    pub account_number_last4: String,
    /// The name the payout partner confirmed for this account.
    pub account_name: String,
    pub verified: bool,
}

const NAME_CHECK_NOT_CONNECTED: &str =
    "Adding a bank account needs the account name check, which is not connected yet.";

// ── Handlers ──────────────────────────────────────────────────────────────────

async fn list_accounts(
    auth: AuthUser,
    State(state): State<AppState>,
) -> Result<Json<Vec<BankAccountResponse>>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let rows = sqlx::query(
        "SELECT id, bank_code, account_number, account_name, verified FROM bank_accounts \
         WHERE user_id = $1 ORDER BY created_at",
    )
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(db_error)?;

    let accounts = rows
        .iter()
        .map(|row| -> Result<BankAccountResponse, ApiError> {
            let number: String = row.try_get("account_number").map_err(db_error)?;
            Ok(BankAccountResponse {
                id: row.try_get("id").map_err(db_error)?,
                bank_code: row.try_get("bank_code").map_err(db_error)?,
                account_number_last4: number[number.len() - 4..].to_string(),
                account_name: row.try_get("account_name").map_err(db_error)?,
                verified: row.try_get("verified").map_err(db_error)?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Json(accounts))
}

async fn add_account(
    auth: AuthUser,
    State(state): State<AppState>,
    Json(req): Json<AddAccountRequest>,
) -> Result<StatusCode, ApiError> {
    // Authenticate first, then check the input, then report the missing name check.
    let _user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    validate_bank_code(&req.bank_code)?;
    validate_account_number(&req.account_number)?;

    Err(ApiError::Unavailable(NAME_CHECK_NOT_CONNECTED.to_string()))
}

async fn remove_account(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Only the owner's account can be removed: another user's id is simply not found.
    let removed =
        sqlx::query("DELETE FROM bank_accounts WHERE id = $1 AND user_id = $2 RETURNING id")
            .bind(id)
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(db_error)?;

    match removed {
        Some(_) => Ok(StatusCode::NO_CONTENT),
        None => Err(ApiError::NotFound),
    }
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("bank account database error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_numbers_must_be_ten_digits() {
        assert!(validate_account_number("0123456789").is_ok());
        for bad in ["", "012345678", "01234567890", "012345678a", " 123456789"] {
            assert!(
                validate_account_number(bad).is_err(),
                "{bad:?} should be refused"
            );
        }
    }

    #[test]
    fn bank_codes_are_three_to_six_digits() {
        assert!(validate_bank_code("044").is_ok());
        assert!(validate_bank_code("100004").is_ok());
        for bad in ["", "04", "1234567", "04a", "0 44"] {
            assert!(
                validate_bank_code(bad).is_err(),
                "{bad:?} should be refused"
            );
        }
    }
}
