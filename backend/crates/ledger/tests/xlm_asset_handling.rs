//! Integration tests for XLM asset handling in the ledger.
//! Verifies that XLM is treated as a first-class citizen alongside ETH, USDC, and BTC.

use engipay_core::{Asset, Money, UserId};
use engipay_ledger::{HoldState, Ledger, LedgerError};

fn user() -> UserId {
    UserId::new()
}

fn xlm(minor: i128) -> Money {
    Money {
        asset: Asset::Xlm,
        minor,
    }
}

fn usdc(minor: i128) -> Money {
    Money {
        asset: Asset::Usdc,
        minor,
    }
}

#[test]
fn xlm_deposit_creates_available_balance() {
    let mut ledger = Ledger::new();
    let alice = user();

    let receipt = ledger.deposit(alice, xlm(5_000_000), "xlm-dep-1").unwrap();
    assert!(!receipt.replayed);

    let balance = ledger.balance(alice, Asset::Xlm);
    assert_eq!(balance.available, 5_000_000);
    assert_eq!(balance.held, 0);
}

#[test]
fn xlm_transfer_moves_between_users() {
    let mut ledger = Ledger::new();
    let alice = user();
    let bob = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .transfer(alice, bob, xlm(3_000_000), "xlm-pay-1")
        .unwrap();

    let alice_balance = ledger.balance(alice, Asset::Xlm);
    assert_eq!(alice_balance.available, 7_000_000);

    let bob_balance = ledger.balance(bob, Asset::Xlm);
    assert_eq!(bob_balance.available, 3_000_000);
}

#[test]
fn xlm_hold_moves_to_held_bucket() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(6_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();

    let balance = ledger.balance(alice, Asset::Xlm);
    // Only the principal moves to held; fee stays in available
    assert_eq!(balance.available, 4_000_000);
    assert_eq!(balance.held, 6_000_000);
}

#[test]
fn xlm_hold_requires_available_balance_to_cover_principal_and_fee() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(1_000_000), "xlm-dep-1").unwrap();

    // Principal 800,000 + fee 300,000 = 1,100,000 > 1,000,000 available
    let err = ledger
        .hold(alice, xlm(800_000), xlm(300_000), "xlm-hold-1")
        .unwrap_err();

    assert_eq!(
        err,
        LedgerError::InsufficientFunds {
            available: xlm(1_000_000),
            requested: xlm(1_100_000),
        }
    );

    // Balance unchanged after failed hold
    let balance = ledger.balance(alice, Asset::Xlm);
    assert_eq!(balance.available, 1_000_000);
    assert_eq!(balance.held, 0);
}

#[test]
fn xlm_hold_rejects_fee_in_different_asset() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();

    let err = ledger
        .hold(
            alice,
            xlm(5_000_000),
            usdc(1_000_000), // Wrong asset for fee
            "xlm-hold-1",
        )
        .unwrap_err();

    assert_eq!(err, LedgerError::InvalidFee);
}

#[test]
fn xlm_release_returns_held_to_available() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(6_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();

    ledger.release("xlm-hold-1").unwrap();

    let balance = ledger.balance(alice, Asset::Xlm);
    assert_eq!(balance.available, 10_000_000);
    assert_eq!(balance.held, 0);
    assert_eq!(ledger.hold_state("xlm-hold-1"), Some(HoldState::Released));
}

#[test]
fn xlm_settlement_moves_principal_to_outflow_and_fee_to_fees() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(9_000_000), xlm(500_000), "xlm-hold-1")
        .unwrap();

    let receipt = ledger.settle("xlm-hold-1", Some(xlm(500_000))).unwrap();
    assert!(!receipt.replayed);

    let balance = ledger.balance(alice, Asset::Xlm);
    // Available before settle: 1M (10M - 9M held)
    // Settlement removes from held bucket and sends to external_outflow (principal) and fees (fee)
    // User available remains 1M
    assert_eq!(balance.available, 1_000_000);
    assert_eq!(balance.held, 0);
    assert_eq!(ledger.hold_state("xlm-hold-1"), Some(HoldState::Settled));
}

#[test]
fn xlm_settlement_without_fee_sends_all_to_outflow() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(4_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();

    ledger.settle("xlm-hold-1", None).unwrap();

    let balance = ledger.balance(alice, Asset::Xlm);
    assert_eq!(balance.held, 0);
    assert_eq!(ledger.hold_state("xlm-hold-1"), Some(HoldState::Settled));
}

#[test]
fn xlm_and_usdc_coexist_independently() {
    let mut ledger = Ledger::new();
    let alice = user();

    // Deposit both assets
    ledger.deposit(alice, xlm(5_000_000), "xlm-dep-1").unwrap();
    ledger.deposit(alice, usdc(1_000_000), "usdc-dep-1").unwrap();

    // Hold each independently
    ledger
        .hold(alice, xlm(2_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();
    ledger
        .hold(alice, usdc(400_000), usdc(10_000), "usdc-hold-1")
        .unwrap();

    // Balances are independent
    let xlm_balance = ledger.balance(alice, Asset::Xlm);
    // Available: 5,000,000 - 2,000,000 (held) = 3,000,000
    assert_eq!(xlm_balance.available, 3_000_000);
    assert_eq!(xlm_balance.held, 2_000_000);

    let usdc_balance = ledger.balance(alice, Asset::Usdc);
    // Available: 1,000,000 - 400,000 (held) = 600,000
    assert_eq!(usdc_balance.available, 600_000);
    assert_eq!(usdc_balance.held, 400_000);
}

#[test]
fn xlm_transfer_between_multiple_users() {
    let mut ledger = Ledger::new();
    let alice = user();
    let bob = user();
    let charlie = user();

    ledger.deposit(alice, xlm(15_000_000), "xlm-dep-1").unwrap();

    // Alice sends to Bob
    ledger
        .transfer(alice, bob, xlm(5_000_000), "xlm-pay-1")
        .unwrap();

    // Bob sends to Charlie
    ledger
        .transfer(bob, charlie, xlm(3_000_000), "xlm-pay-2")
        .unwrap();

    assert_eq!(ledger.balance(alice, Asset::Xlm).available, 10_000_000);
    assert_eq!(ledger.balance(bob, Asset::Xlm).available, 2_000_000);
    assert_eq!(ledger.balance(charlie, Asset::Xlm).available, 3_000_000);
}

#[test]
fn xlm_settlement_with_partial_fee() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(5_000_000), xlm(1_000_000), "xlm-hold-1")
        .unwrap();

    // Settle with a smaller fee than reserved
    ledger
        .settle("xlm-hold-1", Some(xlm(200_000)))
        .unwrap();

    let balance = ledger.balance(alice, Asset::Xlm);
    // Available before: 5M (10M - 5M held)
    // Settlement doesn't change user balance, only moves from held to external
    // User available remains 5M
    assert_eq!(balance.available, 5_000_000);
}

#[test]
fn xlm_retried_deposit_replays_idempotently() {
    let mut ledger = Ledger::new();
    let alice = user();

    let receipt1 = ledger.deposit(alice, xlm(5_000_000), "xlm-dep-1").unwrap();
    assert!(!receipt1.replayed);

    let receipt2 = ledger.deposit(alice, xlm(5_000_000), "xlm-dep-1").unwrap();
    assert!(receipt2.replayed);
    assert_eq!(receipt1.transaction_id, receipt2.transaction_id);

    // Balance should be the same (not doubled)
    let balance = ledger.balance(alice, Asset::Xlm);
    assert_eq!(balance.available, 5_000_000);
}

#[test]
fn xlm_retried_transfer_replays_idempotently() {
    let mut ledger = Ledger::new();
    let alice = user();
    let bob = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();

    let receipt1 = ledger
        .transfer(alice, bob, xlm(3_000_000), "xlm-pay-1")
        .unwrap();
    assert!(!receipt1.replayed);

    let receipt2 = ledger
        .transfer(alice, bob, xlm(3_000_000), "xlm-pay-1")
        .unwrap();
    assert!(receipt2.replayed);
    assert_eq!(receipt1.transaction_id, receipt2.transaction_id);

    // Balances should remain unchanged
    assert_eq!(ledger.balance(alice, Asset::Xlm).available, 7_000_000);
    assert_eq!(ledger.balance(bob, Asset::Xlm).available, 3_000_000);
}

#[test]
fn xlm_non_positive_amount_rejected() {
    let mut ledger = Ledger::new();
    let alice = user();

    let err = ledger.deposit(alice, xlm(0), "xlm-zero").unwrap_err();
    assert_eq!(err, LedgerError::NonPositiveAmount);

    let err = ledger
        .deposit(alice, Money { asset: Asset::Xlm, minor: -1_000_000 }, "xlm-neg")
        .unwrap_err();
    assert_eq!(err, LedgerError::NonPositiveAmount);
}

#[test]
fn xlm_settlement_rejects_fee_larger_than_hold() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(1_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();

    // Fee larger than principal should be rejected
    let err = ledger
        .settle("xlm-hold-1", Some(xlm(1_500_000)))
        .unwrap_err();
    assert_eq!(err, LedgerError::InvalidFee);
}

#[test]
fn xlm_settlement_rejects_fee_in_wrong_asset() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(5_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();

    // Fee in wrong asset
    let err = ledger
        .settle("xlm-hold-1", Some(usdc(50_000)))
        .unwrap_err();
    assert_eq!(err, LedgerError::InvalidFee);
}

#[test]
fn xlm_released_hold_cannot_be_settled() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();
    ledger
        .hold(alice, xlm(5_000_000), xlm(100_000), "xlm-hold-1")
        .unwrap();
    ledger.release("xlm-hold-1").unwrap();

    let err = ledger.settle("xlm-hold-1", None).unwrap_err();
    assert!(matches!(err, LedgerError::HoldClosed { state: HoldState::Released, .. }));
}

#[test]
fn xlm_same_account_transfer_rejected() {
    let mut ledger = Ledger::new();
    let alice = user();

    ledger.deposit(alice, xlm(10_000_000), "xlm-dep-1").unwrap();

    let err = ledger
        .transfer(alice, alice, xlm(1_000_000), "xlm-self")
        .unwrap_err();
    assert_eq!(err, LedgerError::SameAccount);
}
