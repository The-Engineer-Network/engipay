//! `POST /v1/transfers`: move money from the caller to another EngiPay user.
//!
//! The sender is always the authenticated caller, never a field in the body.
//! The recipient is named by their `@tag`. Sending to yourself is refused
//! before the ledger is touched (#123): it moves nothing and only takes locks.

use std::sync::OnceLock;

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::post;
use axum::{Json, Router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::LedgerError;
use engipay_ledger::postgres::PostgresLedgerStore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::middleware::rate_limit::VelocityLimiter;
use crate::routes::auth::AuthUser;

/// A request to send money to another user.
///
/// Money is never a floating point value: `amount` is a decimal string, parsed
/// exactly at the asset's precision.
#[derive(Debug, Clone, Deserialize)]
pub struct TransferRequest {
    /// The recipient's tag, with or without a leading `@`.
    pub recipient: String,
    pub asset: Asset,
    /// Decimal amount, e.g. `"1.50"` USDC.
    pub amount: String,
    /// The caller's idempotency key: retrying with it never sends twice.
    pub reference: String,
}

/// Validation failures for a [`TransferRequest`].
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TransferRequestError {
    #[error("recipient must be an EngiPay tag")]
    EmptyRecipient,
    #[error("amount is not a valid decimal for this asset")]
    InvalidAmount,
    #[error("amount must be greater than zero")]
    NonPositiveAmount,
    #[error("reference must be 1 to 64 characters")]
    InvalidReference,
}

/// A request that passed validation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidTransfer {
    pub recipient_tag: String,
    pub money: Money,
    pub reference: String,
}

impl TransferRequest {
    pub fn validate(&self) -> Result<ValidTransfer, TransferRequestError> {
        let recipient_tag = self.recipient.trim();
        let recipient_tag = recipient_tag
            .strip_prefix('@')
            .unwrap_or(recipient_tag)
            .trim();
        if recipient_tag.is_empty() {
            return Err(TransferRequestError::EmptyRecipient);
        }

        let money = Money::parse(self.asset, &self.amount)
            .map_err(|_| TransferRequestError::InvalidAmount)?;
        if !money.is_positive() {
            return Err(TransferRequestError::NonPositiveAmount);
        }

        let reference = self.reference.trim();
        if reference.is_empty() || reference.chars().count() > 64 {
            return Err(TransferRequestError::InvalidReference);
        }

        Ok(ValidTransfer {
            recipient_tag: recipient_tag.to_owned(),
            money,
            reference: reference.to_owned(),
        })
    }
}

/// Returned once the transfer is in the ledger.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TransferReceipt {
    pub transaction_id: Uuid,
    pub reference: String,
    pub recipient_tag: String,
    pub asset: Asset,
    /// Exact decimal string at the asset's precision.
    pub amount: String,
    /// True when this reference was already applied and nothing moved now.
    pub replayed: bool,
    pub status: TransferStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Completed,
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/transfers", post(create_transfer))
}

/// One limiter for the whole process, so the per-user budget is shared by
/// every request rather than reset on each one.
fn velocity() -> &'static VelocityLimiter {
    static LIMITER: OnceLock<VelocityLimiter> = OnceLock::new();
    LIMITER.get_or_init(VelocityLimiter::new)
}

async fn create_transfer(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<TransferRequest>,
) -> Result<(StatusCode, Json<TransferReceipt>), ApiError> {
    let sender = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let transfer = request
        .validate()
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;

    let recipient = resolve_tag(&pool, &transfer.recipient_tag)
        .await?
        .ok_or_else(|| ApiError::BadRequest("no EngiPay user has that tag".to_owned()))?;
    ensure_not_self(sender, recipient)?;

    velocity()
        .check_sensitive_action(&sender.as_uuid().to_string())
        .await
        .map_err(|(_, message)| ApiError::TooManyRequests(message))?;

    let receipt = PostgresLedgerStore::new(pool)
        .transfer(sender, recipient, transfer.money, &transfer.reference)
        .await
        .map_err(ledger_error)?;

    Ok((
        StatusCode::CREATED,
        Json(TransferReceipt {
            transaction_id: receipt.transaction_id,
            reference: transfer.reference,
            recipient_tag: transfer.recipient_tag,
            asset: transfer.money.asset,
            amount: transfer.money.decimal(),
            replayed: receipt.replayed,
            status: TransferStatus::Completed,
        }),
    ))
}

/// The user who owns `tag`, compared the way tags are unique: trimmed and
/// case-insensitive.
async fn resolve_tag(pool: &sqlx::PgPool, tag: &str) -> Result<Option<UserId>, ApiError> {
    let id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM user_profiles WHERE LOWER(btrim(tag)) = LOWER($1)")
            .bind(tag.trim())
            .fetch_optional(pool)
            .await
            .map_err(|error| ApiError::Internal(error.into()))?;
    Ok(id.map(UserId::from_uuid))
}

/// Refuses a transfer whose recipient is the sender (#123).
pub fn ensure_not_self(sender: UserId, recipient: UserId) -> Result<(), ApiError> {
    if sender == recipient {
        return Err(ApiError::Ledger(LedgerError::SameAccount));
    }
    Ok(())
}

/// Maps the ledger's refusals to client errors; anything else is internal.
fn ledger_error(error: LedgerError) -> ApiError {
    match error {
        LedgerError::SameAccount
        | LedgerError::InsufficientFunds { .. }
        | LedgerError::NonPositiveAmount
        | LedgerError::EmptyReference
        | LedgerError::IdempotencyConflict { .. } => ApiError::Ledger(error),
        other => ApiError::Internal(anyhow::anyhow!(other.to_string())),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, header};
    use axum::response::IntoResponse;
    use http_body_util::BodyExt;
    use serde_json::{Value, json};
    use tower::ServiceExt;

    use super::*;
    use crate::config::Config;
    use crate::router;

    fn request(recipient: &str, amount: &str, reference: &str) -> TransferRequest {
        TransferRequest {
            recipient: recipient.to_owned(),
            asset: Asset::Usdc,
            amount: amount.to_owned(),
            reference: reference.to_owned(),
        }
    }

    async fn body(response: axum::response::Response) -> (StatusCode, Value) {
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }

    // ── Self-transfers (#123) ───────────────────────────────────────────────

    #[test]
    fn a_transfer_to_yourself_is_refused() {
        let me = UserId::new();
        assert!(matches!(
            ensure_not_self(me, me),
            Err(ApiError::Ledger(LedgerError::SameAccount))
        ));
    }

    #[test]
    fn a_transfer_to_someone_else_is_allowed() {
        assert!(ensure_not_self(UserId::new(), UserId::new()).is_ok());
    }

    #[tokio::test]
    async fn a_self_transfer_is_a_400_with_a_stable_code() {
        let me = UserId::new();
        let response = ensure_not_self(me, me).unwrap_err().into_response();
        let (status, json) = body(response).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["error"]["code"], "same_account");
        assert_eq!(
            json["error"]["message"],
            "cannot transfer to the same account"
        );
    }

    #[tokio::test]
    async fn the_ledgers_own_same_account_refusal_is_also_a_400() {
        let response = ledger_error(LedgerError::SameAccount).into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    // ── Validation ──────────────────────────────────────────────────────────

    #[test]
    fn accepts_a_valid_request_and_strips_the_at_sign() {
        let valid = request("@alice", "1.5", "ref-1").validate().unwrap();
        assert_eq!(valid.recipient_tag, "alice");
        assert_eq!(valid.money, Money::parse(Asset::Usdc, "1.5").unwrap());
        assert_eq!(valid.reference, "ref-1");
    }

    #[test]
    fn rejects_an_empty_recipient() {
        assert_eq!(
            request("  @ ", "1", "ref-1").validate(),
            Err(TransferRequestError::EmptyRecipient)
        );
    }

    #[test]
    fn rejects_bad_amounts() {
        for amount in ["-1", "abc", "", "1.00000001"] {
            assert!(
                matches!(
                    request("alice", amount, "ref-1").validate(),
                    Err(TransferRequestError::InvalidAmount
                        | TransferRequestError::NonPositiveAmount)
                ),
                "{amount:?}"
            );
        }
        assert_eq!(
            request("alice", "0", "ref-1").validate(),
            Err(TransferRequestError::NonPositiveAmount)
        );
    }

    #[test]
    fn rejects_empty_and_overlong_references() {
        assert_eq!(
            request("alice", "1", " ").validate(),
            Err(TransferRequestError::InvalidReference)
        );
        assert_eq!(
            request("alice", "1", &"x".repeat(65)).validate(),
            Err(TransferRequestError::InvalidReference)
        );
    }

    // ── HTTP ────────────────────────────────────────────────────────────────

    fn app() -> axum::Router {
        let config = Config::for_tests();
        router(
            AppState {
                database: None,
                config: config.clone(),
            },
            &config,
        )
    }

    fn post(token: Option<&str>, body: Value) -> Request<Body> {
        let mut builder =
            Request::post("/v1/transfers").header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = token {
            builder = builder.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        builder.body(Body::from(body.to_string())).unwrap()
    }

    fn token() -> String {
        crate::auth::jwt::create_token(
            Uuid::new_v4(),
            "wallet".to_owned(),
            Config::for_tests().jwt_secret.as_bytes(),
        )
        .unwrap()
    }

    #[tokio::test]
    async fn requires_a_bearer_token() {
        let request = post(
            None,
            json!({ "recipient": "alice", "asset": "USDC", "amount": "1", "reference": "r" }),
        );
        let response = app().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn invalid_requests_are_refused_before_the_database() {
        let request = post(
            Some(&token()),
            json!({ "recipient": "alice", "asset": "USDC", "amount": "0", "reference": "r" }),
        );
        let (status, json) = body(app().oneshot(request).await.unwrap()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["error"]["message"], "amount must be greater than zero");
    }

    /// Requires `DATABASE_URL`: a user who sends to their own tag gets a 400
    /// and no ledger transaction is written.
    #[ignore = "requires DATABASE_URL"]
    #[tokio::test]
    async fn sending_to_your_own_tag_is_refused_end_to_end() {
        let url = std::env::var("DATABASE_URL").unwrap();
        let pool = sqlx::PgPool::connect(&url).await.unwrap();
        sqlx::migrate!("../../migrations").run(&pool).await.unwrap();

        let me = Uuid::new_v4();
        let tag = format!("self_{}", &me.simple().to_string()[..12]);
        sqlx::query("INSERT INTO users (id) VALUES ($1)")
            .bind(me)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO user_profiles (id, tier, tag) VALUES ($1, 0, $2)")
            .bind(me)
            .bind(&tag)
            .execute(&pool)
            .await
            .unwrap();

        let config = Config::for_tests();
        let app = router(
            AppState {
                database: Some(pool.clone()),
                config: config.clone(),
            },
            &config,
        );
        let token =
            crate::auth::jwt::create_token(me, "wallet".to_owned(), config.jwt_secret.as_bytes())
                .unwrap();
        let reference = format!("self-{me}");
        let request = post(
            Some(&token),
            json!({ "recipient": format!("@{tag}"), "asset": "USDC", "amount": "1", "reference": reference }),
        );
        let (status, json) = body(app.oneshot(request).await.unwrap()).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json["error"]["code"], "same_account");
        let written: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM ledger_transactions WHERE reference = $1")
                .bind(&reference)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(written, 0);
    }
}
