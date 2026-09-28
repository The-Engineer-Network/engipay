#![allow(clippy::arithmetic_side_effects, clippy::unwrap_used)]

use std::collections::HashMap;

use engipay_core::{Asset, Money, UserId};
use engipay_ledger::{Ledger, SystemAccount};
use proptest::prelude::*;

fn money(asset: Asset, minor: i64) -> Money {
    Money::from_minor(asset, i128::from(minor))
}

fn asset(index: u8) -> Asset {
    Asset::ALL[usize::from(index)]
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(500))]

    #[test]
    fn generated_operations_preserve_zero_sum_and_nonnegative_user_balances(
        operations in prop::collection::vec(
            (
                0u8..5,
                0u8..8,
                0u8..8,
                0u8..4,
                -5i64..101,
                0u8..16,
                0i64..101,
                0u8..4,
                any::<bool>(),
            ),
            1..=600,
        )
    ) {
        let users: Vec<UserId> = (0..8).map(|_| UserId::new()).collect();
        let mut ledger = Ledger::new();

        for (step, (kind, from, to, asset_index, amount, reference, fee, fee_asset, has_fee))
            in operations.into_iter().enumerate()
        {
            let from = users[usize::from(from)];
            let to = users[usize::from(to)];
            let operation_asset = asset(asset_index);
            let reference = format!("generated-{reference}");
            let prior_transaction_count = ledger.transactions().len();
            match kind {
                0 => { let _ = ledger.deposit(from, money(operation_asset, amount), &reference); }
                1 => { let _ = ledger.transfer(from, to, money(operation_asset, amount), &reference); }
                2 => { let _ = ledger.hold(from, money(operation_asset, amount), &format!("hold-{reference}")); }
                3 => { let _ = ledger.release(&format!("hold-{reference}")); }
                _ => {
                    let fee = has_fee.then(|| money(asset(fee_asset), fee));
                    let _ = ledger.settle(&format!("hold-{reference}"), fee);
                }
            }

            if ledger.transactions().len() > prior_transaction_count {
                let transaction = ledger.transactions().last().expect("new transaction exists");
                let mut totals = HashMap::<Asset, i128>::new();
                for posting in &transaction.postings {
                    *totals.entry(posting.account.asset).or_default() += posting.amount;
                }
                prop_assert!(
                    totals.values().all(|total| *total == 0),
                    "transaction {} does not balance by asset",
                    transaction.reference,
                );
            }

            let mut users_total = 0i128;
            for user in &users {
                for asset in Asset::ALL {
                    let balance = ledger.balance(*user, asset);
                    prop_assert!(balance.available >= 0 && balance.held >= 0);
                    users_total += balance.available + balance.held;
                }
            }
            let system_total: i128 = Asset::ALL.into_iter().map(|asset| {
                ledger.system_balance(SystemAccount::ExternalInflow, asset)
                    + ledger.system_balance(SystemAccount::ExternalOutflow, asset)
                    + ledger.system_balance(SystemAccount::Fees, asset)
            }).sum();
            prop_assert_eq!(users_total + system_total, 0, "money changed after operation {}", step);
        }
        ledger.verify().expect("generated sequence must preserve ledger invariants");
    }
}
