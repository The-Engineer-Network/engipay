use sqlx::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::error::ApiError;

/// How a split request's shares are allocated across payers (#483).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SplitMode {
    /// Divide the total as evenly as possible; remainder is distributed
    /// one minor unit at a time so shares always sum to the total.
    Equal,
    /// Caller supplies explicit per-payer amounts (must sum to the total).
    Custom,
}

impl SplitMode {
    pub fn parse(value: &str) -> Result<Self, ApiError> {
        match value {
            "equal" => Ok(SplitMode::Equal),
            "custom" => Ok(SplitMode::Custom),
            other => Err(ApiError::BadRequest(format!(
                "invalid split mode: {other}"
            ))),
        }
    }
}

/// Settlement service for payment requests (#130).
/// When a transfer references a payment_request_id, mark it as settled.
/// For split requests (#483), the request only completes once every share
/// has been paid.
pub async fn settle_payment_request(
    pool: &PgPool,
    payment_request_id: Uuid,
) -> Result<(), ApiError> {
    let is_split: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM payment_request_shares WHERE payment_request_id = $1
        )
        "#,
    )
    .bind(payment_request_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    if is_split {
        let all_paid = request_completion_status(pool, payment_request_id).await?;
        if !all_paid {
            // Split is only partially funded; leave the request pending.
            return Ok(());
        }
    }

    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'paid', settled_at = now()
        WHERE id = $1 AND status = 'pending'
        "#,
    )
    .bind(payment_request_id)
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(())
}

/// Create per-payer shares for a split payment request (#483).
///
/// `payers` lists the payer identifiers (one share each). `total_minor` is the
/// request total in minor units. For `SplitMode::Equal` the total is divided
/// via `engipay_core::money::split_amount` so shares always sum to the total
/// (remainder distributed deterministically). For `SplitMode::Custom` the
/// caller must supply exactly one amount per payer via `custom_amounts`.
///
/// All inserts happen in a single transaction: either every share is created
/// or none are.
pub async fn create_split_shares(
    pool: &PgPool,
    request_id: Uuid,
    payers: &[String],
    total_minor: i64,
    mode: SplitMode,
) -> Result<Vec<i64>, ApiError> {
    create_split_shares_with_amounts(pool, request_id, payers, total_minor, mode, None).await
}

/// Variant of [`create_split_shares`] that accepts explicit amounts for
/// `SplitMode::Custom`.
pub async fn create_split_shares_with_amounts(
    pool: &PgPool,
    request_id: Uuid,
    payers: &[String],
    total_minor: i64,
    mode: SplitMode,
    custom_amounts: Option<&[i64]>,
) -> Result<Vec<i64>, ApiError> {
    if payers.is_empty() {
        return Err(ApiError::BadRequest(
            "a split request needs at least one payer".to_string(),
        ));
    }
    if total_minor <= 0 {
        return Err(ApiError::BadRequest(
            "split total must be positive".to_string(),
        ));
    }

    let mut seen = std::collections::HashSet::new();
    for payer in payers {
        if payer.trim().is_empty() {
            return Err(ApiError::BadRequest("payer must not be empty".to_string()));
        }
        if !seen.insert(payer) {
            return Err(ApiError::BadRequest(format!(
                "duplicate payer in split: {payer}"
            )));
        }
    }

    let shares: Vec<i64> = match mode {
        SplitMode::Equal => {
            let amounts = engipay_core::money::split_amount(total_minor, payers.len() as u32)
                .map_err(|e| ApiError::BadRequest(format!("invalid split: {e}")))?;
            amounts.into_iter().map(|a| a as i64).collect()
        }
        SplitMode::Custom => {
            let amounts = custom_amounts.ok_or_else(|| {
                ApiError::BadRequest("custom split requires explicit amounts".to_string())
            })?;
            if amounts.len() != payers.len() {
                return Err(ApiError::BadRequest(
                    "custom split amounts must match payer count".to_string(),
                ));
            }
            if amounts.iter().any(|a| *a < 0) {
                return Err(ApiError::BadRequest(
                    "custom split amounts must be non-negative".to_string(),
                ));
            }
            let sum: i64 = amounts.iter().sum();
            if sum != total_minor {
                return Err(ApiError::BadRequest(format!(
                    "custom split amounts sum to {sum}, expected {total_minor}"
                )));
            }
            amounts.to_vec()
        }
    };

    // Defensive invariant: shares must always sum to the total.
    let share_sum: i64 = shares.iter().sum();
    if share_sum != total_minor {
        return Err(ApiError::Internal(anyhow::anyhow!(
            "split shares sum to {share_sum}, expected {total_minor}"
        )));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    for (payer, amount) in payers.iter().zip(shares.iter()) {
        sqlx::query(
            r#"
            INSERT INTO payment_request_shares
                (payment_request_id, payer, amount_minor, paid_amount_minor, status)
            VALUES ($1, $2, $3, 0, 'pending')
            "#,
        )
        .bind(request_id)
        .bind(payer)
        .bind(amount)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    }

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(shares)
}

/// Record a payment against a single payer's share (#483).
///
/// Increments `paid_amount_minor` and flips the share to `'paid'` once it is
/// fully covered. Returns the share's new status.
pub async fn record_share_payment(
    pool: &PgPool,
    request_id: Uuid,
    payer: &str,
    amount_minor: i64,
) -> Result<String, ApiError> {
    if amount_minor <= 0 {
        return Err(ApiError::BadRequest(
            "share payment amount must be positive".to_string(),
        ));
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let row = sqlx::query(
        r#"
        SELECT amount_minor, paid_amount_minor, status
        FROM payment_request_shares
        WHERE payment_request_id = $1 AND payer = $2
        FOR UPDATE
        "#,
    )
    .bind(request_id)
    .bind(payer)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let row = row.ok_or_else(|| {
        ApiError::NotFound(format!("no share for payer {payer} on request {request_id}"))
    })?;

    let amount: i64 = row
        .try_get("amount_minor")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let paid: i64 = row
        .try_get("paid_amount_minor")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let status: String = row
        .try_get("status")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    if status != "pending" && status != "partial" {
        return Err(ApiError::BadRequest(format!(
            "share for payer {payer} is not payable (status: {status})"
        )));
    }

    let new_paid = paid.saturating_add(amount_minor);
    if new_paid > amount {
        return Err(ApiError::BadRequest(format!(
            "payment of {amount_minor} exceeds remaining share of {}",
            amount - paid
        )));
    }

    let new_status = if new_paid == amount { "paid" } else { "partial" };

    sqlx::query(
        r#"
        UPDATE payment_request_shares
        SET paid_amount_minor = $3, status = $4, updated_at = now()
        WHERE payment_request_id = $1 AND payer = $2
        "#,
    )
    .bind(request_id)
    .bind(payer)
    .bind(new_paid)
    .bind(new_status)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(new_status.to_string())
}

/// Returns `true` when every share of the split request has been fully paid
/// (#483). Returns `false` for requests with no shares.
pub async fn request_completion_status(
    pool: &PgPool,
    request_id: Uuid,
) -> Result<bool, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'paid') AS paid
        FROM payment_request_shares
        WHERE payment_request_id = $1
        "#,
    )
    .bind(request_id)
    .fetch_one(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let total: i64 = row
        .try_get("total")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let paid: i64 = row
        .try_get("paid")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(total > 0 && total == paid)
}

/// Cancel a split request (#483). Only the creator may cancel.
///
/// Unpaid shares are marked `'refunded'` (nothing was collected). Paid shares
/// are marked `'refunded'` and a refund entry is recorded for the amount that
/// was actually collected. The request itself is set to `'expired'`.
pub async fn cancel_split(
    pool: &PgPool,
    request_id: Uuid,
    creator_id: Uuid,
) -> Result<(), ApiError> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let row = sqlx::query(
        r#"
        SELECT creator_id, status
        FROM payment_requests
        WHERE id = $1
        FOR UPDATE
        "#,
    )
    .bind(request_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    let row = row.ok_or_else(|| {
        ApiError::NotFound(format!("payment request {request_id} not found"))
    })?;

    let owner: Uuid = row
        .try_get("creator_id")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    let status: String = row
        .try_get("status")
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    if owner != creator_id {
        return Err(ApiError::Forbidden(
            "only the creator can cancel this request".to_string(),
        ));
    }
    if status != "pending" {
        return Err(ApiError::BadRequest(format!(
            "request cannot be cancelled (status: {status})"
        )));
    }

    // Record refunds for any amounts already collected.
    let paid_shares = sqlx::query(
        r#"
        SELECT payer, paid_amount_minor
        FROM payment_request_shares
        WHERE payment_request_id = $1 AND paid_amount_minor > 0
        "#,
    )
    .bind(request_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    for share in paid_shares {
        let payer: String = share
            .try_get("payer")
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
        let paid_amount: i64 = share
            .try_get("paid_amount_minor")
            .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

        sqlx::query(
            r#"
            INSERT INTO payment_request_refunds
                (payment_request_id, payer, amount_minor, reason)
            VALUES ($1, $2, $3, 'split_cancelled')
            "#,
        )
        .bind(request_id)
        .bind(&payer)
        .bind(paid_amount)
        .execute(&mut *tx)
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
    }

    sqlx::query(
        r#"
        UPDATE payment_request_shares
        SET status = 'refunded', updated_at = now()
        WHERE payment_request_id = $1 AND status <> 'refunded'
        "#,
    )
    .bind(request_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE id = $1
        "#,
    )
    .bind(request_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    tx.commit()
        .await
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(())
}

/// Expiry verification service for background cleanup task (#129).
/// Mark all stale (expired) payment requests as expired.
pub async fn mark_stale_requests_expired(pool: &PgPool) -> Result<u64, ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE payment_requests
        SET status = 'expired'
        WHERE status = 'pending' AND expires_at < now()
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    Ok(result.rows_affected())
}

/// Verify that expired requests cannot be settled.
/// Returns true if request is still settleable (not expired or already paid).
pub async fn is_settleable(pool: &PgPool, payment_request_id: Uuid) -> Result<bool, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT status, expires_at FROM payment_requests
        WHERE id = $1
        "#,
    )
    .bind(payment_request_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;

    match row {
        Some(row) => {
            let expires_at: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc> = row
                .try_get("expires_at")
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            let is_expired = expires_at < sqlx::types::chrono::Utc::now();
            let is_pending: bool = row
                .try_get::<String, _>("status")
                .map(|status| status == "pending")
                .map_err(|e| ApiError::Internal(anyhow::anyhow!(e.to_string())))?;
            Ok(is_pending && !is_expired)
        }
        None => Ok(false),
    }
}
