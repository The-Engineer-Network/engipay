//! Money-moving request bodies must reject unknown fields (issue #704), so a
//! client cannot smuggle in fields such as `user_id` that a handler might
//! later start trusting.

use engipay_api::routes::{
    buy, convert, money_requests, naira, payment_requests, transfers, withdrawals,
};
use serde::de::DeserializeOwned;

/// The unknown field is placed first so serde reports it before any other
/// problem with the (deliberately minimal) body.
fn assert_rejects_unknown<T: DeserializeOwned>(json: &str) {
    let error = serde_json::from_str::<T>(json)
        .err()
        .expect("body with an unknown field must be rejected");
    assert!(
        error.to_string().contains("unknown field"),
        "unexpected error: {error}"
    );
}

#[test]
fn transfer_rejects_unknown_field() {
    assert_rejects_unknown::<transfers::TransferRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn withdrawal_rejects_unknown_field() {
    assert_rejects_unknown::<withdrawals::CreateWithdrawalRequest>(r#"{"extra":1}"#);
}

#[test]
fn convert_quote_rejects_unknown_field() {
    assert_rejects_unknown::<convert::QuoteRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn convert_execute_rejects_unknown_field() {
    assert_rejects_unknown::<convert::ExecuteRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn buy_quote_rejects_unknown_field() {
    assert_rejects_unknown::<buy::QuoteRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn buy_order_rejects_unknown_field() {
    assert_rejects_unknown::<buy::OrderRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn naira_deposit_rejects_unknown_field() {
    assert_rejects_unknown::<naira::StartDepositRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn naira_withdrawal_rejects_unknown_field() {
    assert_rejects_unknown::<naira::StartWithdrawalRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn money_request_create_rejects_unknown_field() {
    assert_rejects_unknown::<money_requests::CreateMoneyRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn money_request_accept_rejects_unknown_field() {
    assert_rejects_unknown::<money_requests::AcceptMoneyRequest>(r#"{"user_id":"x"}"#);
}

#[test]
fn payment_request_pay_rejects_unknown_field() {
    assert_rejects_unknown::<payment_requests::RecordPaymentRequest>(r#"{"user_id":"x"}"#);
}
