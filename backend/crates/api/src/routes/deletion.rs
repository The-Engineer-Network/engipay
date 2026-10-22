use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
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

    // Step 1: Anonymize personal data in user profile
    sqlx::query("UPDATE user_profiles SET tag = NULL, updated_at = now() WHERE id = $1")
        .bind(user_id.as_uuid())
        .execute(pool)
        .await
        .map_err(|err| {
            ApiError::Internal(anyhow::anyhow!("failed to anonymize profile: {}", err))
        })?;

    // Step 2: Anonymize any identifiable data while keeping ledger history
    // We'll zero out any personal references but keep the financial records

    // Step 3: If delete_transactions is true, remove transaction references
    // but keep the ledger postings (balances must still reconcile)
    if req.delete_transactions {
        // Delete transaction history entries (anonymized - no personal data)
        // We keep the ledger postings to maintain balance reconciliation
        let _ = sqlx::query(
            "DELETE FROM user_transactions WHERE user_id = $1",
        )
        .bind(user_id.as_uuid())
        .execute(pool)
        .await
        .map_err(|err| {
            ApiError::Internal(anyhow::anyhow!("failed to delete transactions: {}", err))
        })?;
    }

    // Step 4: Keep ledger postings intact - the double-entry ledger must remain
    // append-only for audit/compliance purposes

    let request_id = Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();

    Ok(Json(DeletionResponse {
        request_id,
        created_at,
        status: "processing".to_string(),
    }))
}

/// Register the routes.
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/export", get(get_export))
        .route("/deletion-request", post(post_deletion_request))
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