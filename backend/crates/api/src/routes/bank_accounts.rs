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

/// Computes the CBN NUBAN check digit for a 3-digit bank code and the first
/// nine digits of the account number. Returns `None` on malformed input.
pub fn nuban_check_digit(bank_code: &str, serial: &str) -> Option<u32> {
    const WEIGHTS: [u32; 12] = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
    if bank_code.len() != 3 || serial.len() != 9 {
        return None;
    }
    let mut sum = 0u32;
    for (digit, weight) in bank_code.chars().chain(serial.chars()).zip(WEIGHTS) {
        sum += digit.to_digit(10)? * weight;
    }
    Some((10 - sum % 10) % 10)
}

/// Rejects a 10-digit account number whose NUBAN check digit does not match,
/// so a typo is caught before a paid name enquiry. Only banks with a 3-digit
/// CBN code use NUBAN; other (e.g. fintech) codes are not checked here.
pub fn validate_nuban_check_digit(bank_code: &str, number: &str) -> Result<(), ApiError> {
    if bank_code.len() != 3 || number.len() != 10 {
        return Ok(());
    }
    let (serial, check) = number.split_at(9);
    match nuban_check_digit(bank_code, serial) {
        Some(expected) if check.chars().next().and_then(|c| c.to_digit(10)) == Some(expected) => {
            Ok(())
        }
        _ => Err(ApiError::BadRequest(
            "Account number is not valid for this bank. Check for a typo.".to_string(),
        )),
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
    validate_nuban_check_digit(&req.bank_code, &req.account_number)?;

    // Cap accounts per user before the paid name check (#697).
    crate::routes::bank_account_cap::enforce_cap(db, user_id, &req.bank_code, &req.account_number)
        .await?;

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

    #[test]
    fn nuban_check_digit_matches_known_numbers() {
        // 044 + 012345678: weighted sum 196 -> check digit 4.
        assert_eq!(nuban_check_digit("044", "012345678"), Some(4));
        // 058 + 000000000: sum 5*7+8*3 = 59 -> check digit 1.
        assert_eq!(nuban_check_digit("058", "000000000"), Some(1));
        // A sum that is a multiple of ten yields check digit 0.
        assert_eq!(nuban_check_digit("000", "000000000"), Some(0));
        assert!(validate_nuban_check_digit("044", "0123456784").is_ok());
        assert!(validate_nuban_check_digit("058", "0000000001").is_ok());
    }

    #[test]
    fn one_digit_typo_is_rejected() {
        assert!(validate_nuban_check_digit("044", "0123456785").is_err());
        assert!(validate_nuban_check_digit("044", "0123456884").is_err());
    }

    #[test]
    fn non_nuban_bank_codes_are_not_checked() {
        assert!(validate_nuban_check_digit("100004", "0123456780").is_ok());
    }
}
