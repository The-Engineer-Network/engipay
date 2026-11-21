use sqlx::PgPool;
use uuid::Uuid;

use crate::error::ApiError;

/// Returns `ApiError::AccountFrozen` if the user's profile is marked frozen.
///
/// This is the single place in the crate where the frozen-account lookup
/// happens; every endpoint that needs the check should call this helper.
pub async fn ensure_not_frozen(pool: &PgPool, user_id: Uuid) -> Result<(), ApiError> {
    let frozen: Option<bool> =
        sqlx::query_scalar("SELECT frozen FROM user_profiles WHERE id = $1")
            .bind(user_id)
            .fetch_optional(pool)
            .await?;

    if frozen.unwrap_or(false) {
        return Err(ApiError::AccountFrozen);
    }

    Ok(())
}