use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

use crate::AppState;
use crate::middleware::VelocityLimiter;
use crate::routes::auth::AuthUser;

/// A validated request to create an internal transfer.
///
/// Money is never represented as a floating point value: `amount` is kept as a
/// string and validated to be a positive integer number of minor units with
/// exact decimal precision.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TransferRequest {
    pub sender: String,
    pub recipient: String,
    pub asset: Asset,
    pub amount: String,
    pub reference: String,
}

/// Supported assets for transfers. Reuses the core asset identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Asset {
    Usd,
    Eur,
    Gbp,
    Eth,
    Usdc,
    Xlm,
    Btc,
}

/// Validation failures for a [`TransferRequest`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferRequestError {
    EmptySender,
    EmptyRecipient,
    InvalidAmount,
    NonPositiveAmount,
    OverPreciseAmount,
    InvalidReference,
}

impl TransferRequest {
    /// Validate the request, returning the normalized recipient on success.
    pub fn validate(&self) -> Result<(), TransferRequestError> {
        if self.sender.trim().is_empty() {
            return Err(TransferRequestError::EmptySender);
        }

        if self.recipient.trim().is_empty() {
            return Err(TransferRequestError::EmptyRecipient);
        }

        validate_amount(&self.amount)?;

        let reference_len = self.reference.chars().count();
        if reference_len == 0 || reference_len > 64 {
            return Err(TransferRequestError::InvalidReference);
        }

        Ok(())
    }

    /// Parse the validated `amount` into an exact integer number of minor units.
    ///
    /// Callers must run [`TransferRequest::validate`] first; this only performs
    /// the lossless conversion and never uses floating point arithmetic.
    pub fn amount_minor_units(&self) -> Result<u128, TransferRequestError> {
        validate_amount(&self.amount)?;
        let integer_part = self
            .amount
            .trim()
            .split_once('.')
            .map(|(int, _)| int)
            .unwrap_or_else(|| self.amount.trim());
        integer_part
            .parse()
            .map_err(|_| TransferRequestError::InvalidAmount)
    }
}

/// Validate that `amount` is a positive integer number of minor units with
/// exact decimal precision (no floating point, no over-precision fractions).
fn validate_amount(amount: &str) -> Result<(), TransferRequestError> {
    let trimmed = amount.trim();
    if trimmed.is_empty() {
        return Err(TransferRequestError::InvalidAmount);
    }

    let (integer_part, fraction_part) = match trimmed.split_once('.') {
        Some((int, frac)) => (int, Some(frac)),
        None => (trimmed, None),
    };

    if integer_part.is_empty() || !integer_part.chars().all(|c| c.is_ascii_digit()) {
        return Err(TransferRequestError::InvalidAmount);
    }

    if let Some(frac) = fraction_part {
        if frac.is_empty() || !frac.chars().all(|c| c.is_ascii_digit()) {
            return Err(TransferRequestError::InvalidAmount);
        }
        // Minor units are integers: any fractional part is over-precision.
        if frac.chars().any(|c| c != '0') {
            return Err(TransferRequestError::OverPreciseAmount);
        }
    }

    let minor_units: u128 = integer_part
        .parse()
        .map_err(|_| TransferRequestError::InvalidAmount)?;

    if minor_units == 0 {
        return Err(TransferRequestError::NonPositiveAmount);
    }

    Ok(())
}

static VELOCITY_LIMITER: LazyLock<VelocityLimiter> = LazyLock::new(VelocityLimiter::new);
/// A structured receipt returned after a transfer is executed successfully.
///
/// `amount` is serialized as a string of exact minor units so money is never
/// represented as a floating point value. `created_at` is an ISO 8601 timestamp
/// and `status` is always `"completed"` for a successful transfer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferReceipt {
    pub transaction_id: String,
    pub reference: String,
    pub sender_tag: String,
    pub recipient_tag: String,
    pub asset: Asset,
    pub amount: String,
    pub created_at: String,
    pub status: TransferStatus,
}

/// Terminal status of a successfully executed transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferStatus {
    Completed,
}

impl TransferReceipt {
    /// Build a completed receipt from a validated request and its ledger result.
    ///
    /// `amount` is rendered from the exact integer minor units, and `created_at`
    /// is provided by the caller as an ISO 8601 timestamp.
    pub fn completed(
        transaction_id: String,
        request: &TransferRequest,
        amount_minor_units: u128,
        created_at: String,
    ) -> Self {
        Self {
            transaction_id,
            reference: request.reference.clone(),
            sender_tag: request.sender.clone(),
            recipient_tag: request.recipient.clone(),
            asset: request.asset,
            amount: amount_minor_units.to_string(),
            created_at,
            status: TransferStatus::Completed,
        }
    }
}

pub fn routes() -> Router<AppState> {
    Router::new().route("/transfers", post(create_transfer))
}

async fn create_transfer(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(request): Json<TransferRequest>,
) -> impl IntoResponse {
    if request.validate().is_err() {
        return StatusCode::UNPROCESSABLE_ENTITY.into_response();
    }

    let amount = match request.amount_minor_units() {
        Ok(amount) => amount,
        Err(_) => return StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    };

    let user_id = match auth.user_id(state.config.jwt_secret.as_bytes()) {
        Ok(id) => id,
        Err(_) => return StatusCode::UNAUTHORIZED.into_response(),
    };
    if let Err((status, message)) = VELOCITY_LIMITER
        .check_sensitive_action(&user_id.to_string())
        .await
    {
        return (status, message).into_response();
    }
    let Some(pool) = state.database.as_ref() else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let asset = match request.asset {
        Asset::Eth => engipay_core::Asset::Eth,
        Asset::Usdc => engipay_core::Asset::Usdc,
        Asset::Xlm => engipay_core::Asset::Xlm,
        Asset::Btc => engipay_core::Asset::Btc,
        _ => return (StatusCode::BAD_REQUEST, "unsupported ledger asset").into_response(),
    };
    let minor = match i128::try_from(amount) {
        Ok(value) => value,
        Err(_) => return StatusCode::UNPROCESSABLE_ENTITY.into_response(),
    };
    use crate::services::recipient::resolve_recipient;
    let sender = match resolve_recipient(pool, &request.sender).await {
        Ok(sender) if sender == user_id => sender,
        _ => return StatusCode::FORBIDDEN.into_response(),
    };
    let recipient = match resolve_recipient(pool, &request.recipient).await {
        Ok(recipient) => recipient,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let result = engipay_ledger::postgres::PostgresLedgerStore::new(pool.clone())
        .transfer(
            sender,
            recipient,
            engipay_core::Money::from_minor(asset, minor),
            &request.reference,
        )
        .await;

    match result {
        Ok(ledger_receipt) => {
            let receipt = TransferReceipt::completed(
                ledger_receipt.transaction_id.to_string(),
                &request,
                amount,
                now_iso8601(),
            );
            (StatusCode::CREATED, Json(receipt)).into_response()
        }
        Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

/// Current time as an ISO 8601 (UTC) timestamp.
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_iso8601(secs)
}

/// Format a Unix timestamp (seconds) as an ISO 8601 UTC string.
fn format_iso8601(unix_secs: u64) -> String {
    i64::try_from(unix_secs)
        .ok()
        .and_then(|seconds| chrono::DateTime::from_timestamp(seconds, 0))
        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn transfer_rejects_invalid_authentication_before_database_access() {
        let state = AppState {
            database: None,
            config: crate::config::Config::for_tests(),
        };
        let response = create_transfer(
            State(state),
            AuthUser {
                token: "invalid".into(),
            },
            Json(request("bob", "alice", "30", "ref")),
        )
        .await
        .into_response();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn authenticated_transfer_enforces_sender_and_idempotency() {
        use engipay_core::{Money, UserId};
        use engipay_ledger::postgres::PostgresLedgerStore;
        use http_body_util::BodyExt;
        let pool = sqlx::PgPool::connect(&std::env::var("DATABASE_URL").expect("test database"))
            .await
            .expect("connection");
        sqlx::migrate!("../../migrations")
            .run(&pool)
            .await
            .expect("migrations");
        let sender = UserId::new();
        let recipient = UserId::new();
        let sender_address = format!("sender-{}", sender.as_uuid());
        let recipient_address = format!("recipient-{}", recipient.as_uuid());
        for (user, address) in [(sender, &sender_address), (recipient, &recipient_address)] {
            sqlx::query("INSERT INTO users(id, wallet_address) VALUES ($1, $2)")
                .bind(user.as_uuid())
                .bind(address)
                .execute(&pool)
                .await
                .expect("user");
        }
        let store = PostgresLedgerStore::new(pool.clone());
        store
            .deposit(
                sender,
                Money::from_minor(engipay_core::Asset::Usdc, 100),
                &format!("seed-{}", sender.as_uuid()),
            )
            .await
            .expect("deposit");
        let config = crate::config::Config::for_tests();
        let auth = AuthUser {
            token: crate::auth::jwt::create_token(
                sender.as_uuid(),
                sender_address.clone(),
                config.jwt_secret.as_bytes(),
            )
            .expect("token"),
        };
        let state = AppState {
            database: Some(pool),
            config,
        };
        let mut transfer = request(
            &sender_address,
            &recipient_address,
            "30",
            &format!("transfer-{}", sender.as_uuid()),
        );
        transfer.asset = Asset::Usdc;
        let mut forged = transfer.clone();
        forged.sender = recipient_address;
        assert_eq!(
            create_transfer(State(state.clone()), auth.clone(), Json(forged))
                .await
                .into_response()
                .status(),
            StatusCode::FORBIDDEN
        );
        let mut ids = Vec::new();
        for _ in 0..2 {
            let response =
                create_transfer(State(state.clone()), auth.clone(), Json(transfer.clone()))
                    .await
                    .into_response();
            assert_eq!(response.status(), StatusCode::CREATED);
            let bytes = response
                .into_body()
                .collect()
                .await
                .expect("response")
                .to_bytes();
            let body: serde_json::Value = serde_json::from_slice(&bytes).expect("receipt");
            ids.push(body["transaction_id"].clone());
            assert_eq!(body["amount"], "30");
        }
        assert_eq!(ids[0], ids[1]);
        for (user, expected) in [(sender, 70), (recipient, 30)] {
            let balances = store.get_user_balances(user).await.expect("balances");
            assert_eq!(
                balances
                    .iter()
                    .find(|b| b.asset == engipay_core::Asset::Usdc)
                    .expect("USDC")
                    .available,
                expected
            );
        }
    }

    fn request(sender: &str, recipient: &str, amount: &str, reference: &str) -> TransferRequest {
        TransferRequest {
            sender: sender.to_string(),
            recipient: recipient.to_string(),
            asset: Asset::Usd,
            amount: amount.to_string(),
            reference: reference.to_string(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        let req = request("bob", "alice", "100", "ref-1");
        assert_eq!(req.validate(), Ok(()));
    }

    #[test]
    fn rejects_empty_sender() {
        let req = request("   ", "alice", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::EmptySender));
    }

    #[test]
    fn rejects_empty_recipient() {
        let req = request("bob", "   ", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::EmptyRecipient));
    }

    #[test]
    fn rejects_negative_amount() {
        let req = request("bob", "alice", "-100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_zero_amount() {
        let req = request("bob", "alice", "0", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::NonPositiveAmount));
    }

    #[test]
    fn rejects_over_precision_amount() {
        let req = request("bob", "alice", "100.5", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::OverPreciseAmount));
    }

    #[test]
    fn rejects_non_numeric_amount() {
        let req = request("bob", "alice", "abc", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_empty_reference() {
        let req = request("bob", "alice", "100", "");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn rejects_overlong_reference() {
        let req = request("bob", "alice", "100", &"x".repeat(65));
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn parses_amount_into_minor_units() {
        let req = request("bob", "alice", "100", "ref-1");
        assert_eq!(req.amount_minor_units(), Ok(100));
    }

    #[test]
    fn parses_amount_with_zero_fraction_into_minor_units() {
        let req = request("bob", "alice", "250.00", "ref-1");
        assert_eq!(req.amount_minor_units(), Ok(250));
    }

    #[test]
    fn rejects_minor_units_for_invalid_amount() {
        let req = request("bob", "alice", "0", "ref-1");
        assert_eq!(
            req.amount_minor_units(),
            Err(TransferRequestError::NonPositiveAmount)
        );
    }

    #[test]
    fn receipt_serializes_with_transaction_metadata() {
        let req = request("bob", "alice", "100", "ref-1");
        let receipt = TransferReceipt::completed(
            "txn-123".to_string(),
            &req,
            100,
            "2024-01-02T03:04:05Z".to_string(),
        );

        let json = serde_json::to_value(&receipt).expect("receipt serializes");

        assert_eq!(json["transaction_id"], "txn-123");
        assert_eq!(json["reference"], "ref-1");
        assert_eq!(json["sender_tag"], "bob");
        assert_eq!(json["recipient_tag"], "alice");
        assert_eq!(json["asset"], "usd");
        assert_eq!(json["amount"], "100");
        assert_eq!(json["created_at"], "2024-01-02T03:04:05Z");
        assert_eq!(json["status"], "completed");
    }

    #[test]
    fn receipt_amount_is_exact_minor_units_string() {
        let req = request("bob", "alice", "250.00", "ref-2");
        let amount = req.amount_minor_units().expect("valid amount");
        let receipt = TransferReceipt::completed(
            "txn-456".to_string(),
            &req,
            amount,
            "2024-06-07T08:09:10Z".to_string(),
        );

        let json = serde_json::to_value(&receipt).expect("receipt serializes");
        assert_eq!(json["amount"], "250");
        assert!(json["amount"].is_string());
    }

    #[test]
    fn receipt_round_trips_through_json() {
        let req = request("bob", "alice", "100", "ref-1");
        let receipt = TransferReceipt::completed(
            "txn-123".to_string(),
            &req,
            100,
            "2024-01-02T03:04:05Z".to_string(),
        );

        let json = serde_json::to_string(&receipt).expect("receipt serializes");
        let decoded: TransferReceipt = serde_json::from_str(&json).expect("receipt deserializes");
        assert_eq!(decoded, receipt);
    }

    #[test]
    fn formats_epoch_as_iso8601() {
        assert_eq!(format_iso8601(0), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn formats_known_timestamp_as_iso8601() {
        // 2024-01-02T03:04:05Z
        assert_eq!(format_iso8601(1_704_164_645), "2024-01-02T03:04:05Z");
    }
}
