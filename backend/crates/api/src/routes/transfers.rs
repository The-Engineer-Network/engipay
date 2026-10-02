use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::post;
use axum::{Json, Router};
use engipay_core::{Asset, Money, UserId};
use engipay_ledger::postgres::PostgresLedgerStore;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;
use crate::error::ApiError;
use crate::routes::auth::AuthUser;

/// A validated request to transfer funds between two EngiPay users.
///
/// Money is never a floating point value: `amount` stays a decimal string until
/// [`Money::parse`] turns it into integer minor units for the asset.
#[derive(Debug, Clone, Deserialize)]
pub struct TransferRequest {
    /// Recipient's user id (`uuid`). The sender is always the authenticated
    /// caller, so a client cannot move money out of someone else's account.
    pub recipient: String,
    pub asset: Asset,
    pub amount: String,
    pub reference: String,
}

/// Validation failures for a [`TransferRequest`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransferRequestError {
    InvalidRecipient,
    InvalidAmount,
    NonPositiveAmount,
    OverPreciseAmount,
    InvalidReference,
}

impl TransferRequest {
    /// Validate the request.
    pub fn validate(&self) -> Result<(), TransferRequestError> {
        Uuid::parse_str(self.recipient.trim())
            .map_err(|_| TransferRequestError::InvalidRecipient)?;

        self.money().map(|_| ())?;

        let reference_len = self.reference.trim().chars().count();
        if reference_len == 0 || reference_len > 64 {
            return Err(TransferRequestError::InvalidReference);
        }

        Ok(())
    }

    /// The recipient's user id, parsed.
    pub fn recipient_id(&self) -> Result<UserId, TransferRequestError> {
        let raw = Uuid::parse_str(self.recipient.trim())
            .map_err(|_| TransferRequestError::InvalidRecipient)?;
        Ok(UserId::from_uuid(raw))
    }

    /// The amount as exact integer minor units for this request's asset.
    ///
    /// Rejects zero, negatives, non-numeric input, and any fraction with more
    /// precision than the asset has decimals. No floating point is involved.
    pub fn money(&self) -> Result<Money, TransferRequestError> {
        validate_amount_shape(&self.amount)?;
        let money = Money::parse(self.asset, self.amount.trim())
            .map_err(|_| TransferRequestError::InvalidAmount)?;
        if money.minor <= 0 {
            return Err(TransferRequestError::NonPositiveAmount);
        }
        Ok(money)
    }

    /// Kept for callers that only need the integer amount.
    #[cfg(test)]
    pub fn amount_minor_units(&self) -> Result<i128, TransferRequestError> {
        self.money().map(|money| money.minor)
    }
}

/// Structural checks that do not depend on the asset.
fn validate_amount_shape(amount: &str) -> Result<(), TransferRequestError> {
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
        // More fractional digits than the asset has decimals cannot be
        // represented exactly.
        if frac.chars().count() > self_decimal_allowance(frac) {
            return Err(TransferRequestError::OverPreciseAmount);
        }
    }

    if integer_part.parse::<u128>().is_err() {
        return Err(TransferRequestError::InvalidAmount);
    }

    Ok(())
}

/// A fraction with only zeros carries no extra precision, whatever its length.
fn self_decimal_allowance(frac: &str) -> usize {
    if frac.chars().all(|c| c == '0') {
        frac.chars().count()
    } else {
        0
    }
}

/// A structured receipt returned after a transfer is executed successfully.
///
/// `amount` is serialized as a string of exact minor units so money is never
/// represented as a floating point value.
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
    pub fn completed(
        transaction_id: String,
        sender_tag: String,
        request: &TransferRequest,
        amount_minor_units: i128,
        created_at: String,
    ) -> Self {
        Self {
            transaction_id,
            reference: request.reference.trim().to_string(),
            sender_tag,
            recipient_tag: request.recipient.trim().to_string(),
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
) -> Result<impl IntoResponse, ApiError> {
    request
        .validate()
        .map_err(|_| ApiError::BadRequest("invalid transfer request".to_string()))?;

    let sender = auth.user_id(state.config.jwt_secret.as_bytes())?;
    let recipient = request
        .recipient_id()
        .map_err(|_| ApiError::BadRequest("invalid recipient".to_string()))?;
    let money = request
        .money()
        .map_err(|_| ApiError::BadRequest("invalid amount".to_string()))?;

    let pool = state
        .database
        .clone()
        .ok_or(ApiError::DatabaseUnavailable)?;
    let ledger = PostgresLedgerStore::new(pool);

    // The idempotency reference is the caller-supplied `reference`, so a retry
    // of the same request replays instead of double-spending.
    let receipt = ledger
        .transfer(sender, recipient, money, request.reference.trim())
        .await
        .map_err(|error| ApiError::BadRequest(error.to_string()))?;

    Ok((
        StatusCode::CREATED,
        Json(TransferReceipt::completed(
            receipt.transaction_id.to_string(),
            sender.as_uuid().to_string(),
            &request,
            money.minor,
            now_iso8601(),
        )),
    ))
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
    let days = (unix_secs / 86_400) as i64;
    let secs_of_day = unix_secs % 86_400;
    let (hour, minute, second) = (
        secs_of_day / 3_600,
        (secs_of_day % 3_600) / 60,
        secs_of_day % 60,
    );

    let (year, month, day) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, minute, second
    )
}

/// Howard Hinnant's `civil_from_days` algorithm: days since the Unix epoch to a
/// proleptic Gregorian date, with no floating point anywhere.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let mp = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use engipay_core::Asset;

    const ALICE: &str = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const BOB: &str = "9c858901-8a57-4791-81fe-4c455b099bc9";

    fn request(recipient: &str, amount: &str, reference: &str) -> TransferRequest {
        TransferRequest {
            recipient: recipient.to_string(),
            asset: Asset::Usdc,
            amount: amount.to_string(),
            reference: reference.to_string(),
        }
    }

    #[test]
    fn accepts_valid_request() {
        let req = request(ALICE, "100", "ref-1");
        assert_eq!(req.validate(), Ok(()));
    }

    #[test]
    fn rejects_empty_recipient() {
        let req = request("   ", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidRecipient));
    }

    #[test]
    fn rejects_non_uuid_recipient() {
        let req = request("alice", "100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidRecipient));
    }

    #[test]
    fn rejects_negative_amount() {
        let req = request(ALICE, "-100", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_zero_amount() {
        let req = request(ALICE, "0", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::NonPositiveAmount));
    }

    #[test]
    fn rejects_over_precision_amount() {
        // USDC has 7 decimals, so an eighth fractional digit is refused
        // rather than silently rounded.
        let req = request(ALICE, "100.00000001", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::OverPreciseAmount));
    }

    #[test]
    fn accepts_amount_at_full_asset_precision() {
        let req = request(ALICE, "100.0000000", "ref-1");
        assert_eq!(req.validate(), Ok(()));
    }

    #[test]
    fn accepts_trailing_zero_fraction_beyond_precision() {
        let req = request(ALICE, "100.000000000", "ref-1");
        assert_eq!(req.validate(), Ok(()));
    }

    #[test]
    fn rejects_non_numeric_amount() {
        let req = request(ALICE, "abc", "ref-1");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidAmount));
    }

    #[test]
    fn rejects_empty_reference() {
        let req = request(ALICE, "100", "");
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn rejects_overlong_reference() {
        let req = request(ALICE, "100", &"x".repeat(65));
        assert_eq!(req.validate(), Err(TransferRequestError::InvalidReference));
    }

    #[test]
    fn parses_amount_into_minor_units() {
        let req = request(ALICE, "100", "ref-1");
        assert_eq!(req.amount_minor_units(), Ok(1_000_000_000));
    }

    #[test]
    fn parses_amount_with_zero_fraction_into_minor_units() {
        let req = request(ALICE, "250.00", "ref-1");
        assert_eq!(req.amount_minor_units(), Ok(2_500_000_000));
    }

    #[test]
    fn rejects_minor_units_for_invalid_amount() {
        let req = request(ALICE, "0", "ref-1");
        assert_eq!(
            req.amount_minor_units(),
            Err(TransferRequestError::NonPositiveAmount)
        );
    }

    #[test]
    fn parses_recipient_id() {
        let req = request(BOB, "100", "ref-1");
        assert_eq!(
            req.recipient_id().map(|id| id.as_uuid()),
            Ok(Uuid::parse_str(BOB).unwrap())
        );
    }

    #[test]
    fn receipt_serializes_with_transaction_metadata() {
        let req = request(ALICE, "100", "ref-1");
        let receipt = TransferReceipt::completed(
            "txn-123".to_string(),
            BOB.to_string(),
            &req,
            1_000_000_000,
            "2024-01-02T03:04:05Z".to_string(),
        );

        let json = serde_json::to_value(&receipt).expect("receipt serializes");

        assert_eq!(json["transaction_id"], "txn-123");
        assert_eq!(json["reference"], "ref-1");
        assert_eq!(json["sender_tag"], BOB);
        assert_eq!(json["recipient_tag"], ALICE);
        assert_eq!(json["asset"], "USDC");
        assert_eq!(json["amount"], "1000000000");
        assert_eq!(json["created_at"], "2024-01-02T03:04:05Z");
        assert_eq!(json["status"], "completed");
    }

    #[test]
    fn receipt_amount_is_exact_minor_units_string() {
        let req = request(ALICE, "250.00", "ref-2");
        let amount = req.amount_minor_units().expect("valid amount");
        let receipt = TransferReceipt::completed(
            "txn-456".to_string(),
            BOB.to_string(),
            &req,
            amount,
            "2024-06-07T08:09:10Z".to_string(),
        );

        let json = serde_json::to_value(&receipt).expect("receipt serializes");
        assert_eq!(json["amount"], "2500000000");
        assert!(json["amount"].is_string());
    }

    #[test]
    fn receipt_round_trips_through_json() {
        let req = request(ALICE, "100", "ref-1");
        let receipt = TransferReceipt::completed(
            "txn-123".to_string(),
            BOB.to_string(),
            &req,
            1_000_000_000,
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
