//! Linking several wallets to one EngiPay account.
//!
//! - `GET    /v1/wallets`      the account's wallets, including the first (sign-in) wallet
//! - `POST   /v1/wallets`      link a wallet, proving control of it with a signed message
//! - `DELETE /v1/wallets/{id}` schedule a linked wallet's removal after a cooldown
//!
//! Rules:
//! - Linking needs a fresh sign-in nonce and a signature from the wallet being
//!   linked, so the caller must control it.
//! - A wallet already linked to any account, including as an account's first
//!   wallet, cannot be linked again. Moving it between accounts is not offered.
//! - Removal is scheduled, not immediate: the wallet keeps signing in until
//!   `UNLINK_COOLDOWN` has passed.
//! - An account always keeps at least one sign-in method. A removal that would
//!   leave none is refused.
//!
//! This version links EVM wallets only. Linking a Stellar wallet needs the
//! SEP-10 challenge check moved out of the sign-in handler; it is refused
//! here with a clear message until that is done.

use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;
use crate::routes::auth::siwe::{nonce_from_message, normalise_address, recover_address};

/// How long a removed wallet keeps working after the removal is requested.
pub const UNLINK_COOLDOWN: Duration = Duration::from_secs(72 * 60 * 60);

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/wallets", get(list_wallets).post(link_wallet))
        .route("/wallets/{id}", delete(schedule_removal))
}

#[derive(Debug, Deserialize)]
pub struct LinkWalletRequest {
    /// Only "evm" is accepted for now.
    pub chain: String,
    pub address: String,
    /// The exact message the wallet signed, including its `Nonce:` line.
    pub message: String,
    /// 65-byte signature as hex.
    pub signature: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct WalletResponse {
    /// `None` for the account's first (sign-in) wallet, which is not a linked row.
    pub id: Option<Uuid>,
    pub chain: String,
    pub address: String,
    /// `"active"`, or `"removal_scheduled"` with `removal_effective_at` set.
    pub status: String,
    pub removal_effective_at: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RemovalResponse {
    pub id: Uuid,
    pub removal_effective_at: String,
}

fn db_error(error: sqlx::Error) -> ApiError {
    ApiError::Internal(anyhow::anyhow!("wallet database error: {error}"))
}

fn format_time(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The chain a sign-in wallet belongs to, read from its address format.
fn chain_of_primary(address: &str) -> &'static str {
    if address.starts_with("0x") {
        "evm"
    } else {
        "stellar"
    }
}

async fn list_wallets(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<WalletResponse>>, ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let mut wallets = Vec::new();

    let primary: Option<String> =
        sqlx::query_scalar("SELECT wallet_address FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(db_error)?
            .flatten();
    if let Some(address) = primary {
        wallets.push(WalletResponse {
            id: None,
            chain: chain_of_primary(&address).to_string(),
            address,
            status: "active".to_string(),
            removal_effective_at: None,
        });
    }

    // Removed wallets (past their removal time) are no longer listed.
    let rows = sqlx::query(
        "SELECT id, chain, address, removal_effective_at FROM user_wallets \
         WHERE user_id = $1 AND (removal_effective_at IS NULL OR removal_effective_at > now()) \
         ORDER BY linked_at",
    )
    .bind(user_id)
    .fetch_all(db)
    .await
    .map_err(db_error)?;

    for row in rows {
        let effective: Option<DateTime<Utc>> =
            row.try_get("removal_effective_at").map_err(db_error)?;
        wallets.push(WalletResponse {
            id: Some(row.try_get("id").map_err(db_error)?),
            chain: row.try_get("chain").map_err(db_error)?,
            address: row.try_get("address").map_err(db_error)?,
            status: if effective.is_some() {
                "removal_scheduled".to_string()
            } else {
                "active".to_string()
            },
            removal_effective_at: effective.map(format_time),
        });
    }
    Ok(Json(wallets))
}

async fn link_wallet(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<LinkWalletRequest>,
) -> Result<(StatusCode, Json<WalletResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    if req.chain != "evm" {
        return Err(ApiError::BadRequest(
            "only EVM wallets can be linked right now".to_string(),
        ));
    }
    let claimed = normalise_address(&req.address).ok_or_else(|| {
        ApiError::BadRequest("address must be a 0x-prefixed 20-byte hex value".to_string())
    })?;
    let nonce = nonce_from_message(&req.message)
        .ok_or_else(|| ApiError::BadRequest("message must include a Nonce line".to_string()))?;
    let recovered = recover_address(&req.message, &req.signature)
        .ok_or_else(|| ApiError::Unauthorized("signature is not valid".to_string()))?;
    if recovered != claimed {
        return Err(ApiError::Unauthorized(
            "signature does not match the address".to_string(),
        ));
    }

    // Consuming the nonce, the ownership checks and the insert share one
    // transaction, so a refused link does not use up the nonce.
    let mut tx = db.begin().await.map_err(db_error)?;

    let consumed = sqlx::query(
        "UPDATE auth_nonces SET consumed_at = now() \
         WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now()",
    )
    .bind(&nonce)
    .execute(&mut *tx)
    .await
    .map_err(db_error)?;
    if consumed.rows_affected() == 0 {
        return Err(ApiError::Unauthorized(
            "nonce is unknown, already used, or expired".to_string(),
        ));
    }

    // Already linked to any account, including as a first (sign-in) wallet?
    let linked_to: Option<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM user_wallets WHERE chain = 'evm' AND address = $1 \
         UNION ALL \
         SELECT id FROM users WHERE wallet_address = $1 \
         LIMIT 1",
    )
    .bind(&claimed)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    if let Some(owner) = linked_to {
        return Err(ApiError::Conflict(if owner == user_id {
            "this wallet is already linked to your account".to_string()
        } else {
            "this wallet is already linked to another account".to_string()
        }));
    }

    let id: Uuid = sqlx::query_scalar(
        "INSERT INTO user_wallets (user_id, chain, address) VALUES ($1, 'evm', $2) RETURNING id",
    )
    .bind(user_id)
    .bind(&claimed)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match error {
        // Another request linked the same wallet between the check and the insert.
        sqlx::Error::Database(ref db_err) if db_err.is_unique_violation() => {
            ApiError::Conflict("this wallet is already linked to an account".to_string())
        }
        other => db_error(other),
    })?;

    tx.commit().await.map_err(db_error)?;

    Ok((
        StatusCode::CREATED,
        Json(WalletResponse {
            id: Some(id),
            chain: "evm".to_string(),
            address: claimed,
            status: "active".to_string(),
            removal_effective_at: None,
        }),
    ))
}

async fn schedule_removal(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<(StatusCode, Json<RemovalResponse>), ApiError> {
    let user_id = auth.user_id(state.config.jwt_secret.as_bytes())?.as_uuid();
    let db = state
        .database
        .as_ref()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let mut tx = db.begin().await.map_err(db_error)?;

    // Lock the account so two concurrent removals cannot both pass the
    // last-method check below.
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db_error)?
        .ok_or(ApiError::NotFound)?;

    let current: Option<Option<DateTime<Utc>>> = sqlx::query_scalar(
        "SELECT removal_effective_at FROM user_wallets \
         WHERE id = $1 AND user_id = $2 \
           AND (removal_effective_at IS NULL OR removal_effective_at > now())",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(db_error)?;
    match current {
        None => return Err(ApiError::NotFound),
        Some(Some(_)) => {
            return Err(ApiError::Conflict(
                "this wallet is already scheduled for removal".to_string(),
            ));
        }
        Some(None) => {}
    }

    // Sign-in methods left after this one goes: the first wallet, if set,
    // plus linked wallets not already scheduled for removal.
    let primary_present: bool =
        sqlx::query_scalar("SELECT wallet_address IS NOT NULL FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(db_error)?;
    let other_linked: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_wallets \
         WHERE user_id = $1 AND id <> $2 AND removal_effective_at IS NULL",
    )
    .bind(user_id)
    .bind(id)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;
    if !primary_present && other_linked == 0 {
        return Err(ApiError::Conflict(
            "this is your only sign-in method; add another wallet before removing it".to_string(),
        ));
    }

    let effective_at: DateTime<Utc> = sqlx::query_scalar(
        "UPDATE user_wallets \
         SET removal_effective_at = now() + make_interval(secs => $3) \
         WHERE id = $1 AND user_id = $2 \
         RETURNING removal_effective_at",
    )
    .bind(id)
    .bind(user_id)
    .bind(UNLINK_COOLDOWN.as_secs() as f64)
    .fetch_one(&mut *tx)
    .await
    .map_err(db_error)?;

    tx.commit().await.map_err(db_error)?;

    Ok((
        StatusCode::ACCEPTED,
        Json(RemovalResponse {
            id,
            removal_effective_at: format_time(effective_at),
        }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cooldown_is_three_days() {
        assert_eq!(UNLINK_COOLDOWN, Duration::from_secs(259_200));
    }

    #[test]
    fn primary_wallet_chain_follows_address_format() {
        assert_eq!(chain_of_primary("0xabc"), "evm");
        assert_eq!(chain_of_primary("GABC"), "stellar");
    }
}
