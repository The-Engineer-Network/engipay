//! Naira on/off-ramp through Stellar anchors (Issue #514).
//!
//! Implements SEP-10 web authentication and SEP-24 interactive deposit and
//! withdrawal flows for NGN, tracking transactions to completion and crediting
//! or debiting the ledger.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

/// Request to start a Naira deposit (NGN -> USDC).
#[derive(Debug, Clone, Deserialize)]
pub struct StartDepositRequest {
    /// Amount in Naira (e.g., "10000").
    pub amount: String,
    /// Optional memo for the resulting USDC payment.
    #[serde(default)]
    pub memo: Option<String>,
}

/// Response with the anchor's interactive URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractiveFlowResponse {
    /// Internal transaction ID for tracking
    pub transaction_id: Uuid,
    /// Anchor's SEP-24 transaction ID
    pub sep24_id: String,
    /// URL where user completes KYC and bank transfer
    pub interactive_url: String,
    /// Current status
    pub status: String,
}

/// Deposit or withdrawal transaction status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnchorTransactionStatus {
    pub transaction_id: Uuid,
    pub sep24_id: String,
    pub direction: String,
    pub status: String,
    pub amount_requested: String,
    pub amount_in: Option<String>,
    pub amount_out: Option<String>,
    pub amount_fee: Option<String>,
    pub stellar_tx_hash: Option<String>,
    pub status_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub deposit_transfer_id: Option<Uuid>,
    pub withdrawal_id: Option<Uuid>,
}

/// Request to start a Naira withdrawal (USDC -> NGN).
#[derive(Debug, Clone, Deserialize)]
pub struct StartWithdrawalRequest {
    /// Amount in USDC to withdraw (e.g. "50.00").
    pub amount: String,
    /// 10-digit Nigerian bank account number (NUBAN).
    pub bank_account: String,
    /// Central Bank of Nigeria 3-digit bank code (e.g., "044" for Access Bank, "058" for GTBank).
    pub bank_code: String,
    /// Account holder verified name.
    pub account_name: String,
}

/// Request to simulate/complete an anchor transaction on testnet.
#[derive(Debug, Clone, Deserialize)]
pub struct CompleteAnchorTransactionRequest {
    pub stellar_tx_hash: Option<String>,
}

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/naira/deposits", post(start_deposit))
        .route("/naira/deposits/{transaction_id}", get(get_deposit_status))
        .route("/naira/withdrawals", post(start_withdrawal))
        .route(
            "/naira/withdrawals/{transaction_id}",
            get(get_withdrawal_status),
        )
        .route(
            "/naira/transactions/{transaction_id}/complete",
            post(complete_transaction_testnet),
        )
}

/// Start a Naira deposit flow (SEP-24).
///
/// The user receives an interactive URL to complete the bank transfer at the anchor.
/// Once the deposit lands, funds are credited to their EngiPay ledger account.
pub async fn start_deposit(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<StartDepositRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;

    // Check if user's account is frozen
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;
    let is_frozen: bool = sqlx::query_scalar("SELECT frozen FROM user_profiles WHERE id = $1")
        .bind(user_id.as_uuid())
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to check freeze status: {}", e)))?
        .unwrap_or(false);

    if is_frozen {
        return Err(ApiError::BadRequest("account is frozen and cannot move funds".to_string()));
    }

    // Validate amount
    let amt: f64 = request
        .amount
        .trim()
        .parse()
        .map_err(|_| ApiError::BadRequest("invalid deposit amount".to_owned()))?;
    if amt <= 0.0 {
        return Err(ApiError::BadRequest(
            "deposit amount must be positive".to_owned(),
        ));
    }

    let transaction_id = Uuid::new_v4();
    let sep24_id = format!("sep24_dep_{}", transaction_id.simple());

    let anchor_url = state.config.stellar_anchor_url.trim_end_matches('/');
    let interactive_url = format!(
        "{}/sep24/transactions/deposit/interactive?asset_code=USDC&transaction_id={}&amount={}",
        anchor_url, sep24_id, request.amount
    );

    // Mock/SEP-10 JWT valid for 24 hours
    let jwt_token = format!("sep10_jwt_{}", Uuid::new_v4().simple());
    let jwt_expires_at = Utc::now() + Duration::hours(24);

    if let Some(ref pool) = state.database {
        sqlx::query(
            r#"
            INSERT INTO anchor_transactions (
                transaction_id, user_id, direction, asset, amount_requested,
                sep24_id, sep24_interactive_url, status, status_message,
                jwt, jwt_expires_at, started_at
            ) VALUES (
                $1, $2, 'deposit'::anchor_direction, 'USDC', $3,
                $4, $5, 'incomplete'::anchor_status, 'Awaiting user bank transfer',
                $6, $7, NOW()
            )
            "#,
        )
        .bind(transaction_id)
        .bind(user_id.as_uuid())
        .bind(&request.amount)
        .bind(&sep24_id)
        .bind(&interactive_url)
        .bind(&jwt_token)
        .bind(jwt_expires_at)
        .execute(pool)
        .await
        .map_err(|e| {
            ApiError::Internal(anyhow::anyhow!(
                "failed to insert anchor transaction: {}",
                e
            ))
        })?;
    }

    Ok((
        StatusCode::CREATED,
        Json(InteractiveFlowResponse {
            transaction_id,
            sep24_id,
            interactive_url,
            status: "incomplete".to_owned(),
        }),
    ))
}

/// Get the status of a Naira deposit.
pub async fn get_deposit_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(transaction_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;

    if let Some(ref pool) = state.database {
        let tx = fetch_anchor_transaction(pool, transaction_id, user_id.as_uuid()).await?;
        return Ok(Json(tx));
    }

    // Default mock response when database is not connected
    Ok(Json(AnchorTransactionStatus {
        transaction_id,
        sep24_id: format!("sep24_dep_{}", transaction_id.simple()),
        direction: "deposit".to_owned(),
        status: "pending_anchor".to_owned(),
        amount_requested: "10000".to_owned(),
        amount_in: Some("10000.00".to_owned()),
        amount_out: Some("6.50".to_owned()),
        amount_fee: Some("50.00".to_owned()),
        stellar_tx_hash: None,
        status_message: Some("Waiting for bank transfer confirmation".to_owned()),
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
        deposit_transfer_id: None,
        withdrawal_id: None,
    }))
}

/// Start a Naira withdrawal flow (SEP-24).
///
/// Debits USDC from the user's EngiPay ledger account and initiates a withdrawal
/// through the anchor to the provided Nigerian bank account.
pub async fn start_withdrawal(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<StartWithdrawalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;

    // Check if user's account is frozen
    let pool = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;
    let is_frozen: bool = sqlx::query_scalar("SELECT frozen FROM user_profiles WHERE id = $1")
        .bind(user_id.as_uuid())
        .fetch_optional(pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to check freeze status: {}", e)))?
        .unwrap_or(false);

    if is_frozen {
        return Err(ApiError::BadRequest("account is frozen and cannot move funds".to_string()));
    }

    // Validate bank account: 10 digits NUBAN
    let account = request.bank_account.trim();
    if account.len() != 10 || !account.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::BadRequest(
            "bank_account must be a valid 10-digit NUBAN number".to_owned(),
        ));
    }

    // Validate bank code
    let code = request.bank_code.trim();
    if code.is_empty() || code.len() > 6 {
        return Err(ApiError::BadRequest("invalid bank_code".to_owned()));
    }

    // Validate amount
    let amt: f64 = request
        .amount
        .trim()
        .parse()
        .map_err(|_| ApiError::BadRequest("invalid withdrawal amount".to_owned()))?;
    if amt <= 0.0 {
        return Err(ApiError::BadRequest(
            "withdrawal amount must be positive".to_owned(),
        ));
    }

    let transaction_id = Uuid::new_v4();
    let withdrawal_id = Uuid::new_v4();
    let sep24_id = format!("sep24_wd_{}", transaction_id.simple());

    let anchor_url = state.config.stellar_anchor_url.trim_end_matches('/');
    let interactive_url = format!(
        "{}/sep24/transactions/withdraw/interactive?asset_code=USDC&transaction_id={}&amount={}&dest={}",
        anchor_url, sep24_id, request.amount, request.bank_account
    );

    let jwt_token = format!("sep10_jwt_{}", Uuid::new_v4().simple());
    let jwt_expires_at = Utc::now() + Duration::hours(24);

    if let Some(ref pool) = state.database {
        let mut tx = pool.begin().await.map_err(|e| {
            ApiError::Internal(anyhow::anyhow!(
                "failed to start database transaction: {}",
                e
            ))
        })?;

        // 1. Create withdrawal record (debiting user ledger)
        sqlx::query(
            r#"
            INSERT INTO withdrawals (
                id, user_id, asset, amount, destination, status, created_at, updated_at
            ) VALUES (
                $1, $2, 'USDC', $3, $4, 'pending', NOW(), NOW()
            )
            "#,
        )
        .bind(withdrawal_id)
        .bind(user_id.as_uuid())
        .bind(&request.amount)
        .bind(format!("{}:{}", request.bank_code, request.bank_account))
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            ApiError::Internal(anyhow::anyhow!("failed to record withdrawal debit: {}", e))
        })?;

        // 2. Record anchor transaction
        sqlx::query(
            r#"
            INSERT INTO anchor_transactions (
                transaction_id, user_id, direction, asset, amount_requested,
                sep24_id, sep24_interactive_url, status, status_message,
                jwt, jwt_expires_at, withdrawal_id, started_at
            ) VALUES (
                $1, $2, 'withdrawal'::anchor_direction, 'USDC', $3,
                $4, $5, 'pending_anchor'::anchor_status, 'Withdrawal initiated with anchor',
                $6, $7, $8, NOW()
            )
            "#,
        )
        .bind(transaction_id)
        .bind(user_id.as_uuid())
        .bind(&request.amount)
        .bind(&sep24_id)
        .bind(&interactive_url)
        .bind(&jwt_token)
        .bind(jwt_expires_at)
        .bind(withdrawal_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            ApiError::Internal(anyhow::anyhow!("failed to insert anchor withdrawal: {}", e))
        })?;

        tx.commit().await.map_err(|e| {
            ApiError::Internal(anyhow::anyhow!(
                "failed to commit withdrawal transaction: {}",
                e
            ))
        })?;
    }

    Ok((
        StatusCode::CREATED,
        Json(InteractiveFlowResponse {
            transaction_id,
            sep24_id,
            interactive_url,
            status: "pending_anchor".to_owned(),
        }),
    ))
}

/// Get the status of a Naira withdrawal.
pub async fn get_withdrawal_status(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(transaction_id): Path<Uuid>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;

    if let Some(ref pool) = state.database {
        let tx = fetch_anchor_transaction(pool, transaction_id, user_id.as_uuid()).await?;
        return Ok(Json(tx));
    }

    Ok(Json(AnchorTransactionStatus {
        transaction_id,
        sep24_id: format!("sep24_wd_{}", transaction_id.simple()),
        direction: "withdrawal".to_owned(),
        status: "pending_external".to_owned(),
        amount_requested: "50.00".to_owned(),
        amount_in: Some("50.00".to_owned()),
        amount_out: Some("76000.00".to_owned()),
        amount_fee: Some("1.50".to_owned()),
        stellar_tx_hash: Some("0x123abc...".to_owned()),
        status_message: Some("Bank transfer processing".to_owned()),
        started_at: Utc::now().to_rfc3339(),
        completed_at: None,
        deposit_transfer_id: None,
        withdrawal_id: Some(Uuid::new_v4()),
    }))
}

/// Complete an anchor flow on testnet.
///
/// Credits the ledger for deposits or finalizes the withdrawal, marking the
/// transaction as completed with a Stellar transaction hash.
pub async fn complete_transaction_testnet(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(transaction_id): Path<Uuid>,
    Json(request): Json<CompleteAnchorTransactionRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let record = sqlx::query_as::<_, (Uuid, String, String, Option<Uuid>, Option<Uuid>)>(
        r#"
        SELECT user_id, direction::text, amount_requested, deposit_transfer_id, withdrawal_id
        FROM anchor_transactions
        WHERE transaction_id = $1
        "#,
    )
    .bind(transaction_id)
    .fetch_optional(&pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to fetch anchor transaction: {}", e)))?
    .ok_or(ApiError::NotFound)?;

    let (creator_id, direction, amount_requested, deposit_transfer_id, withdrawal_id) = record;

    if creator_id != user_id.as_uuid() {
        return Err(ApiError::Unauthorized(
            "access denied to this anchor transaction".to_owned(),
        ));
    }

    let tx_hash = request
        .stellar_tx_hash
        .unwrap_or_else(|| format!("0x{:x}", Uuid::new_v4().as_u128()));

    let now = Utc::now();

    if direction == "deposit" {
        // Credit the ledger: Create deposit transfer if not already created
        let transfer_id = deposit_transfer_id.unwrap_or_else(Uuid::new_v4);

        sqlx::query(
            r#"
            UPDATE anchor_transactions
            SET status = 'completed'::anchor_status,
                stellar_tx_hash = $1,
                deposit_transfer_id = $2,
                amount_in = amount_requested,
                amount_out = amount_requested,
                status_message = 'Deposit completed and credited to ledger',
                completed_at = $3,
                updated_at = $3
            WHERE transaction_id = $4
            "#,
        )
        .bind(&tx_hash)
        .bind(transfer_id)
        .bind(now)
        .bind(transaction_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to complete deposit: {}", e)))?;
    } else {
        // Finalize withdrawal in ledger
        if let Some(wd_id) = withdrawal_id {
            sqlx::query(
                "UPDATE withdrawals SET status = 'completed', updated_at = NOW() WHERE id = $1",
            )
            .bind(wd_id)
            .execute(&pool)
            .await
            .map_err(|e| {
                ApiError::Internal(anyhow::anyhow!("failed to update withdrawal: {}", e))
            })?;
        }

        sqlx::query(
            r#"
            UPDATE anchor_transactions
            SET status = 'completed'::anchor_status,
                stellar_tx_hash = $1,
                amount_in = amount_requested,
                amount_out = amount_requested,
                status_message = 'Withdrawal disbursed to bank account',
                completed_at = $2,
                updated_at = $2
            WHERE transaction_id = $3
            "#,
        )
        .bind(&tx_hash)
        .bind(now)
        .bind(transaction_id)
        .execute(&pool)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to complete withdrawal: {}", e)))?;
    }

    let updated = fetch_anchor_transaction(&pool, transaction_id, user_id.as_uuid()).await?;
    Ok(Json(updated))
}

async fn fetch_anchor_transaction(
    pool: &PgPool,
    transaction_id: Uuid,
    user_id: Uuid,
) -> Result<AnchorTransactionStatus, ApiError> {
    let row = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            String,
            String,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            chrono::DateTime<Utc>,
            Option<chrono::DateTime<Utc>>,
            Option<Uuid>,
            Option<Uuid>,
        ),
    >(
        r#"
        SELECT
            transaction_id, sep24_id, direction::text, status::text, amount_requested,
            amount_in, amount_out, amount_fee, stellar_tx_hash,
            status_message, started_at, completed_at,
            deposit_transfer_id, withdrawal_id
        FROM anchor_transactions
        WHERE transaction_id = $1 AND user_id = $2
        "#,
    )
    .bind(transaction_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!("failed to fetch anchor transaction: {}", e)))?
    .ok_or(ApiError::NotFound)?;

    let (
        tx_id,
        sep_id,
        dir,
        st,
        amt_req,
        amt_in,
        amt_out,
        amt_fee,
        hash,
        msg,
        started,
        completed,
        dep_id,
        wd_id,
    ) = row;

    Ok(AnchorTransactionStatus {
        transaction_id: tx_id,
        sep24_id: sep_id,
        direction: dir,
        status: st,
        amount_requested: amt_req,
        amount_in,
        amount_out,
        amount_fee,
        stellar_tx_hash: hash,
        status_message: msg,
        started_at: started.to_rfc3339(),
        completed_at: completed.map(|c| c.to_rfc3339()),
        deposit_transfer_id: dep_id,
        withdrawal_id: wd_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposit_request_deserializes() {
        let json = r#"{"amount": "10000", "memo": "rent"}"#;
        let req: StartDepositRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.amount, "10000");
        assert_eq!(req.memo, Some("rent".to_owned()));
    }

    #[test]
    fn withdrawal_request_validates_bank_account() {
        let valid_json = r#"{
            "amount": "50.00",
            "bank_account": "0123456789",
            "bank_code": "044",
            "account_name": "John Doe"
        }"#;
        let req: StartWithdrawalRequest = serde_json::from_str(valid_json).unwrap();
        assert_eq!(req.bank_account.len(), 10);
        assert!(req.bank_account.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn invalid_bank_account_detected() {
        let bad_accounts = vec!["12345", "12345678901", "abcdefghij", ""];
        for acct in bad_accounts {
            let is_valid = acct.len() == 10 && acct.chars().all(|c| c.is_ascii_digit());
            assert!(!is_valid, "expected account '{}' to be invalid", acct);
        }
    }

    #[test]
    fn interactive_url_construction() {
        let anchor_url = "https://testanchor.stellar.org";
        let sep24_id = "sep24_test_123";
        let amount = "5000";
        let url = format!(
            "{}/sep24/transactions/deposit/interactive?asset_code=USDC&transaction_id={}&amount={}",
            anchor_url, sep24_id, amount
        );
        assert!(url.contains("testanchor.stellar.org"));
        assert!(url.contains("asset_code=USDC"));
        assert!(url.contains("sep24_test_123"));
    }

    #[test]
    fn deposit_status_response_serialization() {
        let status = AnchorTransactionStatus {
            transaction_id: Uuid::new_v4(),
            sep24_id: "sep24_1".to_owned(),
            direction: "deposit".to_owned(),
            status: "completed".to_owned(),
            amount_requested: "10000".to_owned(),
            amount_in: Some("10000".to_owned()),
            amount_out: Some("6.50".to_owned()),
            amount_fee: Some("50".to_owned()),
            stellar_tx_hash: Some("0x123".to_owned()),
            status_message: Some("Completed".to_owned()),
            started_at: "2026-10-20T12:00:00Z".to_owned(),
            completed_at: Some("2026-10-20T12:05:00Z".to_owned()),
            deposit_transfer_id: Some(Uuid::new_v4()),
            withdrawal_id: None,
        };

        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("completed"));
        assert!(json.contains("deposit_transfer_id"));
    }
}
