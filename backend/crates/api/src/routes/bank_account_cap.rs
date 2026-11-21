//! Per-user cap on saved bank accounts (#697).

use sqlx::PgPool;
use uuid::Uuid;

use crate::error::ApiError;

pub const MAX_BANK_ACCOUNTS: i64 = 5;

/// True when adding one more new account would exceed the cap.
pub fn would_exceed_cap(existing: i64, already_saved: bool) -> bool {
    !already_saved && existing >= MAX_BANK_ACCOUNTS
}

/// Refuse a new account beyond the cap. Re-adding an account the user already
/// has is an update, not a new account, so it is still allowed.
pub async fn enforce_cap(
    db: &PgPool,
    user_id: Uuid,
    bank_code: &str,
    account_number: &str,
) -> Result<(), ApiError> {
    let (existing, already_saved): (i64, bool) = sqlx::query_as(
        "SELECT count(*), \
                COALESCE(bool_or(bank_code = $2 AND account_number = $3), false) \
         FROM bank_accounts WHERE user_id = $1",
    )
    .bind(user_id)
    .bind(bank_code)
    .bind(account_number)
    .fetch_one(db)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("bank account cap check failed: {e}")))?;

    if would_exceed_cap(existing, already_saved) {
        return Err(ApiError::BadRequest(format!(
            "You can save at most {MAX_BANK_ACCOUNTS} bank accounts. Remove one to add another."
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifth_account_allowed() {
        assert!(!would_exceed_cap(4, false));
    }

    #[test]
    fn sixth_account_refused() {
        assert!(would_exceed_cap(5, false));
        assert!(would_exceed_cap(9, false));
    }

    #[test]
    fn re_adding_existing_account_allowed_at_cap() {
        assert!(!would_exceed_cap(5, true));
    }
}
