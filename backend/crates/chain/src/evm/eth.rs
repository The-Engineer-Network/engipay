//! Native ETH deposits: top-level transactions whose `to` is a deposit address.

use std::collections::{HashMap, HashSet};

use engipay_core::{Asset, Chain, Money};
use serde::Deserialize;

use super::confirmations::confirmations_u32;
use super::{Skipped, normalize_address, parse_quantity, parse_u64};
use crate::ObservedDeposit;

/// `eth_getBlockByNumber(n, true)`: only the fields deposits depend on.
#[derive(Debug, Clone, Deserialize)]
pub struct Block {
    pub number: String,
    pub transactions: Vec<Transaction>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Transaction {
    pub hash: String,
    /// `None` for contract creation.
    #[serde(default)]
    pub to: Option<String>,
    pub value: String,
}

/// One entry of `eth_getBlockReceipts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub transaction_hash: String,
    /// `0x1` success, `0x0` reverted.
    pub status: String,
}

/// Turns one transaction into an ETH deposit. `deposit_addresses` must hold
/// [`normalize_address`]ed addresses; `succeeded` comes from the receipt.
pub fn deposit_from_transaction(
    tx: &Transaction,
    succeeded: bool,
    block_number: u64,
    current_block: u64,
    deposit_addresses: &HashSet<String>,
) -> Result<ObservedDeposit, Skipped> {
    let address = tx
        .to
        .as_deref()
        .and_then(normalize_address)
        .filter(|to| deposit_addresses.contains(to))
        .ok_or(Skipped::NotIncoming)?;

    let wei = parse_quantity(&tx.value).ok_or(Skipped::Malformed("value is not a hex quantity"))?;
    if wei <= 0 {
        return Err(Skipped::NotIncoming);
    }
    // A reverted transaction still carries `value`, but none of it moved.
    if !succeeded {
        return Err(Skipped::Failed);
    }

    let money = Money::from_network_units(Asset::Eth, Chain::Base, wei)
        .map_err(|_| Skipped::Malformed("value out of range"))?;

    Ok(ObservedDeposit {
        money,
        address,
        reference: format!("base:eth:{}", tx.hash.to_ascii_lowercase()),
        confirmations: confirmations_u32(block_number, current_block),
    })
}

/// Every ETH deposit in `block`. Transactions without a successful receipt are
/// never credited.
// ponytail: top-level transfers only; ETH forwarded by contracts (internal
// transactions) needs trace_block/debug_traceBlock, add when a user sends that way.
pub fn deposits_in_block(
    block: &Block,
    receipts: &[Receipt],
    current_block: u64,
    deposit_addresses: &HashSet<String>,
) -> Result<Vec<ObservedDeposit>, Skipped> {
    let block_number = parse_u64(&block.number).ok_or(Skipped::Malformed("block number"))?;
    let status: HashMap<String, bool> = receipts
        .iter()
        .map(|r| (r.transaction_hash.to_ascii_lowercase(), r.status == "0x1"))
        .collect();

    Ok(block
        .transactions
        .iter()
        .filter_map(|tx| {
            let succeeded = status
                .get(&tx.hash.to_ascii_lowercase())
                .copied()
                .unwrap_or(false);
            match deposit_from_transaction(tx, succeeded, block_number, current_block, deposit_addresses) {
                Ok(deposit) => Some(deposit),
                Err(Skipped::NotIncoming) => None,
                Err(reason) => {
                    tracing::warn!(tx = %tx.hash, ?reason, "ETH transfer to a deposit address not credited");
                    None
                }
            }
        })
        .collect())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    const USER: &str = "0xAbC0000000000000000000000000000000000001";

    fn addresses() -> HashSet<String> {
        [normalize_address(USER).unwrap()].into()
    }

    fn block() -> (Block, Vec<Receipt>) {
        let block = serde_json::from_value(json!({
            "number": "0x64",
            "transactions": [
                // 1 ETH to the user (checksum-cased differently): credited.
                { "hash": "0xAA", "to": "0xabc0000000000000000000000000000000000001", "value": "0xde0b6b3a7640000" },
                // Zero value (e.g. a contract call): ignored.
                { "hash": "0xbb", "to": USER, "value": "0x0" },
                // Someone else's address: ignored.
                { "hash": "0xcc", "to": "0x0000000000000000000000000000000000000002", "value": "0x1" },
                // Contract creation: no `to`.
                { "hash": "0xdd", "to": null, "value": "0x1" },
                // Reverted: ignored.
                { "hash": "0xee", "to": USER, "value": "0x5" },
            ]
        }))
        .unwrap();
        let receipts = serde_json::from_value(json!([
            { "transactionHash": "0xaa", "status": "0x1" },
            { "transactionHash": "0xbb", "status": "0x1" },
            { "transactionHash": "0xcc", "status": "0x1" },
            { "transactionHash": "0xdd", "status": "0x1" },
            { "transactionHash": "0xee", "status": "0x0" },
        ]))
        .unwrap();
        (block, receipts)
    }

    #[test]
    fn detects_eth_deposit_in_block() {
        let (block, receipts) = block();
        let deposits = deposits_in_block(&block, &receipts, 111, &addresses()).unwrap();
        assert_eq!(
            deposits,
            vec![ObservedDeposit {
                money: Money::from_minor(Asset::Eth, 1_000_000_000_000_000_000),
                address: "0xabc0000000000000000000000000000000000001".to_owned(),
                reference: "base:eth:0xaa".to_owned(),
                confirmations: 12,
            }]
        );
    }

    #[test]
    fn reverted_and_receiptless_transfers_are_not_credited() {
        let (block, _) = block();
        let tx = &block.transactions[4];
        assert_eq!(
            deposit_from_transaction(tx, false, 100, 111, &addresses()),
            Err(Skipped::Failed)
        );
        // No receipts at all: nothing is credited.
        assert!(
            deposits_in_block(&block, &[], 111, &addresses())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn malformed_value_is_rejected() {
        let tx = Transaction {
            hash: "0x1".into(),
            to: Some(USER.into()),
            value: "1000".into(),
        };
        assert_eq!(
            deposit_from_transaction(&tx, true, 1, 1, &addresses()),
            Err(Skipped::Malformed("value is not a hex quantity"))
        );
    }

    #[test]
    fn malformed_block_number_is_rejected() {
        let (mut block, receipts) = block();
        block.number = "100".into();
        assert!(deposits_in_block(&block, &receipts, 111, &addresses()).is_err());
    }
}
