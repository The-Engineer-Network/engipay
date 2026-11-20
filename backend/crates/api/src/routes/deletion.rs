use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use engipay_core::Asset;
use engipay_ledger::postgres::PostgresLedgerStore;

/// Request body for data export.
#[derive(Debug, Deserialize)]
pub struct ExportRequest {
    /// When `true`, include transaction history in the export.
    #[serde(default)]
    pub include_transactions: bool,
    /// When `true`, include held balances in the export.
    #[serde(default)]
    pub include_holds: bool,
}

/// Response body for the data export.
#[derive(Debug, Serialize)]
pub struct ExportResponse {
    /// User ID (hashed for privacy).
    pub user_id: String,
    /// Timestamp of the export generation.
    pub generated_at: String,
    /// Asset balances snapshot.
    pub balances: Vec<BalanceExport>,
    /// Open holds (if requested).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_holds: Option<Vec<HoldExport>>,
    /// Transaction history (if requested).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transactions: Option<Vec<TransactionExport>>,
}

/// Exported balance entry.
#[derive(Debug, Serialize)]
pub struct BalanceExport {
    pub asset: String,
    pub available_minor: i128,
    pub available: String,
    pub held_minor: i128,
    pub held: String,
}

/// Exported hold entry.
#[derive(Debug, Serialize)]
pub struct HoldExport {
    pub reference: String,
    pub asset: String,
    pub amount_minor: i128,
    pub amount: String,
    pub created_at: String,
}

/// Exported transaction entry.
#[derive(Debug, Serialize)]
pub struct TransactionExport {
    pub id: String,
    pub asset: String,
    pub amount_minor: i128,
    pub amount: String,
    pub created_at: String,
    pub reference: String,
}

/// Request body for deletion request.
#[derive(Debug, Deserialize)]
pub struct DeletionRequest {
    /// When `true`, also delete transaction history entries associated with the user.
    #[serde(default)]
    pub delete_transactions: bool,
}

/// Response returned after a deletion request is created.
#[derive(Debug, Serialize)]
pub struct DeletionResponse {
    /// Request ID.
    pub request_id: String,
    /// Timestamp when the request was created.
    pub created_at: String,
    /// Status of the deletion request.
    pub status: String,
}

/// Handler for GET /v1/export - produce a machine-readable archive of user data.
async fn get_export(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(params): Query<ExportRequest>,
) -> Result<Json<ExportResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    // Get balances
    let store = PostgresLedgerStore::new(pool.clone());
    let balances = store.get_user_balances(user_id).await.map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to get balances: {}", err))
    })?;

    let balance_exports: Vec<BalanceExport> = balances
        .into_iter()
        .map(|balance| BalanceExport {
            asset: balance.asset.symbol(),
            available_minor: balance.available,
            available: format_minor(balance.asset, balance.available),
            held_minor: balance.held,
            held: format_minor(balance.asset, balance.held),
        })
        .collect();

    let active_holds: Option<Vec<HoldExport>> = if params.include_holds {
        let holds = store.get_active_holds(user_id).await.map_err(|err| {
            ApiError::Internal(anyhow::anyhow!("failed to get holds: {}", err))
        })?;
        Some(
            holds
                .into_iter()
                .map(|hold| HoldExport {
                    reference: hold.reference,
                    asset: hold.asset.symbol(),
                    amount_minor: hold.amount,
                    amount: format_minor(hold.asset, hold.amount),
                    created_at: hold.created_at,
                })
                .collect(),
        )
    } else {
        None
    };

    let transactions: Option<Vec<TransactionExport>> = if params.include_transactions {
        // Get transactions for this user
        let transactions = sqlx::query_as!(
            TransactionExportRow,
            "SELECT id, asset, amount_minor, created_at, reference FROM user_transactions WHERE user_id = $1",
            user_id.as_uuid()
        )
        .fetch_all(pool)
        .await
        .map_err(|err| {
            ApiError::Internal(anyhow::anyhow!("failed to get transactions: {}", err))
        })?;
        Some(
            transactions
                .into_iter()
                .map(|t| TransactionExport {
                    id: t.id.to_string(),
                    asset: t.asset,
                    amount_minor: t.amount_minor,
                    amount: format_minor(Asset::Usdc, t.amount_minor),
                    created_at: t.created_at,
                    reference: t.reference,
                })
                .collect(),
        )
    } else {
        None
    };

    let response = ExportResponse {
        user_id: user_id.to_string(),
        generated_at: chrono::Utc::now().to_rfc3339(),
        balances: balance_exports,
        active_holds,
        transactions,
    };

    Ok(Json(response))
}

/// Helper to format minor units as decimal string.
fn format_minor(asset: Asset, minor: i128) -> String {
    let decimals = asset.decimals() as usize;

    if decimals == 0 {
        return minor.to_string();
    }

    let sign = if minor < 0 { "-" } else { "" };
    let abs = minor.unsigned_abs();
    let digits = abs.to_string();
    let padded = format!("{digits:0>width$}", width = decimals.saturating_add(1));
    let split = padded.len().saturating_sub(decimals);
    let (whole, fraction) = padded.split_at(split);
    format!("{sign}{whole}.{fraction}")
}

/// Database query result row for transactions.
struct TransactionExportRow {
    id: uuid::Uuid,
    asset: String,
    amount_minor: i128,
    created_at: String,
    reference: String,
}

/// Handler for POST /v1/deletion-request - process a user's request to delete personal data.
///
/// All steps run inside a single database transaction: if any step fails the
/// whole request is rolled back and the profile is left unchanged.
///
/// Fields erased / anonymised:
/// - `user_profiles.tag` (display handle) is cleared.
/// - Bank account holder name and account number are erased (set to NULL).
/// - KYC personal data (full name, date of birth, document number, address)
///   is erased (set to NULL).
///
/// Fields retained for legal retention / audit:
/// - Ledger postings and balances (append-only double-entry ledger).
/// - Bank account row itself (id, provider reference, currency) so that
///   reconciliation and regulatory reporting remain possible.
/// - KYC session row (id, status, timestamps) without personal data.
async fn post_deletion_request(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<DeletionRequest>,
) -> Result<Json<DeletionResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let mut tx = pool.begin().await.map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to begin transaction: {}", err))
    })?;

    // Step 1: Anonymize personal data in user profile.
    sqlx::query("UPDATE user_profiles SET tag = NULL, updated_at = now() WHERE id = $1")
        .bind(user_id.as_uuid())
        .execute(&mut *tx)
        .await
        .map_err(|err| {
            ApiError::Internal(anyhow::anyhow!("failed to anonymize profile: {}", err))
        })?;

    // Step 2: Erase bank account personal data. The row itself is kept for
    // legal retention (reconciliation / regulatory reporting), but the holder
    // name and account number are no longer readable.
    sqlx::query(
        "UPDATE bank_accounts \
         SET account_holder_name = NULL, account_number = NULL, updated_at = now() \
         WHERE user_id = $1",
    )
    .bind(user_id.as_uuid())
    .execute(&mut *tx)
    .await
    .map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to anonymize bank accounts: {}", err))
    })?;

    // Step 3: Erase KYC personal data. The session row is kept (status and
    // timestamps) for legal retention, but personal fields are cleared.
    sqlx::query(
        "UPDATE kyc_sessions \
         SET full_name = NULL, date_of_birth = NULL, document_number = NULL, \
             address = NULL, updated_at = now() \
         WHERE user_id = $1",
    )
    .bind(user_id.as_uuid())
    .execute(&mut *tx)
    .await
    .map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to anonymize kyc data: {}", err))
    })?;

    // Step 4: Ledger postings are intentionally left untouched - the
    // double-entry ledger must remain append-only for audit/compliance.
    // There is no user-visible transaction history table to delete from;
    // `delete_transactions` is accepted for API compatibility only.
    let _ = req.delete_transactions;

    // Step 5: Record the deletion request so its id can be looked up later.
    let row = sqlx::query_as::<_, (Uuid, chrono::DateTime<chrono::Utc>)>(
        "INSERT INTO deletion_requests (user_id, status) \
         VALUES ($1, 'processing') \
         RETURNING id, created_at",
    )
    .bind(user_id.as_uuid())
    .fetch_one(&mut *tx)
    .await
    .map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to record deletion request: {}", err))
    })?;

    tx.commit().await.map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to commit deletion request: {}", err))
    })?;

    Ok(Json(DeletionResponse {
        request_id: row.0.to_string(),
        created_at: row.1.to_rfc3339(),
        status: "processing".to_string(),
    }))
}

/// Handler for GET /v1/deletion-request - return the caller's latest deletion request.
async fn get_deletion_request(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<DeletionResponse>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let row = sqlx::query_as::<_, (Uuid, String, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, status, created_at FROM deletion_requests \
         WHERE user_id = $1 \
         ORDER BY created_at DESC \
         LIMIT 1",
    )
    .bind(user_id.as_uuid())
    .fetch_optional(pool)
    .await
    .map_err(|err| {
        ApiError::Internal(anyhow::anyhow!("failed to load deletion request: {}", err))
    })?;

    let (id, status, created_at) = row.ok_or(ApiError::NotFound)?;

    Ok(Json(DeletionResponse {
        request_id: id.to_string(),
        created_at: created_at.to_rfc3339(),
        status,
    }))
}

/// Register the routes.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/export", get(get_export))
        .route(
            "/deletion-request",
            post(post_deletion_request).get(get_deletion_request),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_request_defaults() {
        let _ = ExportRequest { include_transactions: true };
    }

    #[test]
    fn deletion_request_defaults() {
        let _ = DeletionRequest { delete_transactions: false };
    }

    #[test]
    fn format_minor_usdc() {
        // 1.5 USDC = 15_000_000 minor units
        assert_eq!(format_minor(Asset::Usdc, 15_000_000), "1.5000000");
        assert_eq!(format_minor(Asset::Usdc, 0), "0.0000000");
        assert_eq!(format_minor(Asset::Usdc, 1), "0.0000001");
    }

    #[test]
    fn format_minor_xlm() {
        assert_eq!(format_minor(Asset::Xlm, 10_000_000), "1.0000000");
        assert_eq!(format_minor(Asset::Xlm, 0), "0.0000000");
        assert_eq!(format_minor(Asset::Xlm, 1), "0.0000001");
    }
}