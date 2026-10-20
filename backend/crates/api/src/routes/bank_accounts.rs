//! Payout bank accounts: the Nigerian accounts that receive Naira from sales.
//!
//! An account is saved only after the payout partner confirms the account name
//! (the NUBAN name enquiry). The name check is performed by the configured
//! [`BankNameCheck`] provider — in development and tests a fake always succeeds.
//!
//! The full account number is never returned in list responses: only the last
//! four digits are included, as `account_number_last4`.

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
use crate::services::bank_name_check::NameCheckError;

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
    /// Last 4 digits only — the full number is never returned.
    pub account_number_last4: String,
    /// The name the payout partner confirmed for this account.
    pub account_name: String,
    pub verified: bool,
}

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
        "SELECT id, bank_code, account_number, account_name, verified \
         FROM bank_accounts \
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
) -> Result<(StatusCode, Json<BankAccountResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    validate_bank_code(&req.bank_code)?;
    validate_account_number(&req.account_number)?;

    // Name enquiry with the configured provider. Logs only the last 4 digits.
    let account_name = state
        .bank_name_check
        .lookup(&req.bank_code, &req.account_number)
        .map_err(|e| match e {
            NameCheckError::NotFound => ApiError::BadRequest(
                "Account not found: check the bank code and account number.".to_string(),
            ),
            NameCheckError::Unavailable => {
                ApiError::Unavailable("Bank name check is temporarily unavailable.".to_string())
            }
            NameCheckError::Provider(msg) => {
                ApiError::Internal(anyhow::anyhow!("name check provider error: {msg}"))
            }
        })?
        .name;

    let row = sqlx::query(
        "INSERT INTO bank_accounts \
             (id, user_id, bank_code, account_number, account_name, verified) \
         VALUES (gen_random_uuid(), $1, $2, $3, $4, true) \
         ON CONFLICT (user_id, bank_code, account_number) \
         DO UPDATE SET account_name = EXCLUDED.account_name, verified = true \
         RETURNING id",
    )
    .bind(user_id)
    .bind(&req.bank_code)
    .bind(&req.account_number)
    .bind(&account_name)
    .fetch_one(db)
    .await
    .map_err(db_error)?;

    let id: Uuid = row.try_get("id").map_err(db_error)?;
    let last4 = req.account_number[req.account_number.len() - 4..].to_string();

    Ok((
        StatusCode::CREATED,
        Json(BankAccountResponse {
            id,
            bank_code: req.bank_code,
            account_number_last4: last4,
            account_name,
            verified: true,
        }),
    ))
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
