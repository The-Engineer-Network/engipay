//! USDC deposits: ERC-20 `Transfer` logs into deposit addresses, emitted only by
//! the canonical Base USDC contract.

use std::collections::HashSet;

use engipay_core::{Asset, Chain, Money};
use serde::Deserialize;
use serde_json::{Value, json};

use super::confirmations::confirmations_u32;
use super::{Skipped, normalize_address, parse_u64};
use crate::ObservedDeposit;

/// `keccak256("Transfer(address,address,uint256)")`.
pub const TRANSFER_TOPIC: &str =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BaseNetwork {
    Mainnet,
    Sepolia,
}

impl BaseNetwork {
    /// Circle's native USDC, lowercased. Any other `Transfer` emitter is ignored.
    pub const fn usdc_contract(self) -> &'static str {
        match self {
            BaseNetwork::Mainnet => "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            BaseNetwork::Sepolia => "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
        }
    }
}

/// One entry of `eth_getLogs`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Log {
    pub address: String,
    pub topics: Vec<String>,
    pub data: String,
    pub block_number: String,
    pub transaction_hash: String,
    pub log_index: String,
    /// Set when a reorg dropped the log.
    #[serde(default)]
    pub removed: bool,
}

/// `eth_getLogs` params for USDC transfers into any of `deposit_addresses`
/// (which must be [`normalize_address`]ed). topic2 is the indexed `to`.
pub fn transfer_filter(
    network: BaseNetwork,
    from_block: u64,
    to_block: u64,
    deposit_addresses: &HashSet<String>,
) -> Value {
    let to_topics: Vec<String> = deposit_addresses
        .iter()
        .map(|a| format!("0x{:0>64}", a.trim_start_matches("0x")))
        .collect();
    json!([{
        "address": network.usdc_contract(),
        "fromBlock": format!("{from_block:#x}"),
        "toBlock": format!("{to_block:#x}"),
        "topics": [TRANSFER_TOPIC, Value::Null, to_topics],
    }])
}

/// Decodes a `Transfer` log into `(to, value)` in token units.
pub fn decode_transfer(log: &Log) -> Result<(String, i128), Skipped> {
    let [topic0, _from, to] = log.topics.as_slice() else {
        return Err(Skipped::Malformed("Transfer has three topics"));
    };
    if !topic0.eq_ignore_ascii_case(TRANSFER_TOPIC) {
        return Err(Skipped::NotIncoming);
    }
    let to = word(to)
        .and_then(|w| w.strip_prefix(&"0".repeat(24)))
        .and_then(|a| normalize_address(&format!("0x{a}")))
        .ok_or(Skipped::Malformed("topic2 is not an address"))?;
    // uint256, but anything past 127 bits cannot be real USDC.
    let value = word(&log.data)
        .and_then(|w| w.strip_prefix(&"0".repeat(32)))
        .and_then(|low| u128::from_str_radix(low, 16).ok())
        .and_then(|v| i128::try_from(v).ok())
        .ok_or(Skipped::Malformed("data is not a uint256 in range"))?;
    Ok((to, value))
}

/// Turns one log into a USDC deposit, refusing logs from any contract other
/// than `network`'s canonical USDC.
pub fn deposit_from_log(
    log: &Log,
    network: BaseNetwork,
    current_block: u64,
    deposit_addresses: &HashSet<String>,
) -> Result<ObservedDeposit, Skipped> {
    if log.removed {
        return Err(Skipped::NotIncoming);
    }
    // The RPC filter asks for this contract, but the RPC is not trusted.
    if normalize_address(&log.address).as_deref() != Some(network.usdc_contract()) {
        return Err(Skipped::UnauthorizedContract(log.address.clone()));
    }
    let (to, units) = decode_transfer(log)?;
    if !deposit_addresses.contains(&to) || units <= 0 {
        return Err(Skipped::NotIncoming);
    }
    let block_number = parse_u64(&log.block_number).ok_or(Skipped::Malformed("block number"))?;
    let log_index = parse_u64(&log.log_index).ok_or(Skipped::Malformed("log index"))?;
    // Base USDC has 6 decimals; the ledger stores USDC at 7. `from_network_units`
    // applies the per-network precision table (no hand-rolled `* 10`).
    let money = Money::from_network_units(Asset::Usdc, Chain::Base, units)
        .map_err(|_| Skipped::Malformed("value out of range"))?;

    Ok(ObservedDeposit {
        money,
        address: to,
        reference: format!(
            "base:{}:{log_index}",
            log.transaction_hash.to_ascii_lowercase()
        ),
        confirmations: confirmations_u32(block_number, current_block),
    })
}

/// Every USDC deposit in an `eth_getLogs` response.
pub fn deposits_from_logs(
    logs: &[Log],
    network: BaseNetwork,
    current_block: u64,
    deposit_addresses: &HashSet<String>,
) -> Vec<ObservedDeposit> {
    logs.iter()
        .filter_map(|log| match deposit_from_log(log, network, current_block, deposit_addresses) {
            Ok(deposit) => Some(deposit),
            Err(Skipped::NotIncoming) => None,
            Err(reason) => {
                if reason.is_security_sensitive() {
                    tracing::warn!(tx = %log.transaction_hash, ?reason, "Transfer from an unauthorized token contract discarded");
                } else {
                    tracing::warn!(tx = %log.transaction_hash, ?reason, "USDC transfer not credited");
                }
                None
            }
        })
        .collect()
}

/// The 64 hex digits of a `0x`-prefixed 32-byte word.
fn word(input: &str) -> Option<&str> {
    input
        .strip_prefix("0x")
        .filter(|hex| hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    const USER: &str = "0xabc0000000000000000000000000000000000001";
    const USER_TOPIC: &str = "0x000000000000000000000000abc0000000000000000000000000000000000001";
    const SENDER_TOPIC: &str = "0x0000000000000000000000001111111111111111111111111111111111111111";
    // 2.5 USDC = 2_500_000 = 0x2625a0 (6 decimals).
    const AMOUNT: &str = "0x00000000000000000000000000000000000000000000000000000000002625a0";

    fn addresses() -> HashSet<String> {
        [USER.to_owned()].into()
    }

    fn log(emitter: &str) -> Log {
        serde_json::from_value(json!({
            "address": emitter,
            "topics": [TRANSFER_TOPIC, SENDER_TOPIC, USER_TOPIC],
            "data": AMOUNT,
            "blockNumber": "0x64",
            "transactionHash": "0xABCD",
            "logIndex": "0x3",
        }))
        .unwrap()
    }

    fn usdc_log() -> Log {
        log("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
    }

    #[test]
    fn decodes_to_address_and_value() {
        assert_eq!(
            decode_transfer(&usdc_log()),
            Ok((USER.to_owned(), 2_500_000))
        );
    }

    #[test]
    fn detects_usdc_deposit_at_ledger_precision() {
        let deposits = deposits_from_logs(&[usdc_log()], BaseNetwork::Mainnet, 110, &addresses());
        assert_eq!(
            deposits,
            vec![ObservedDeposit {
                // Base's 6 decimals scaled to the ledger's 7.
                money: Money::from_minor(Asset::Usdc, 25_000_000),
                address: USER.to_owned(),
                reference: "base:0xabcd:3".to_owned(),
                confirmations: 11,
            }]
        );
    }

    #[test]
    fn base_six_decimals_scale_to_ledger_seven_without_truncation() {
        // 1 minor unit on Base (0.000001 USDC) becomes 10 minor units at 7 decimals.
        assert_eq!(
            Money::from_network_units(Asset::Usdc, Chain::Base, 1),
            Ok(Money::from_minor(Asset::Usdc, 10))
        );
        // 2.5 USDC: 2_500_000 (6dp) -> 25_000_000 (7dp), exact, no rounding.
        assert_eq!(
            Money::from_network_units(Asset::Usdc, Chain::Base, 2_500_000),
            Ok(Money::from_minor(Asset::Usdc, 25_000_000))
        );
        // The reverse direction recovers the original 6-decimal amount exactly.
        let ledger = Money::from_network_units(Asset::Usdc, Chain::Base, 2_500_000).unwrap();
        assert_eq!(ledger.to_network_units(Chain::Base), Ok(2_500_000));
    }

    #[test]
    fn logs_from_unauthorized_contracts_are_discarded() {
        let fake = log("0x9999999999999999999999999999999999999999");
        assert_eq!(
            deposit_from_log(&fake, BaseNetwork::Mainnet, 200, &addresses()),
            Err(Skipped::UnauthorizedContract(fake.address.clone()))
        );
        assert!(deposits_from_logs(&[fake], BaseNetwork::Mainnet, 200, &addresses()).is_empty());
    }

    #[test]
    fn mainnet_usdc_is_not_accepted_on_testnet() {
        assert!(matches!(
            deposit_from_log(&usdc_log(), BaseNetwork::Sepolia, 200, &addresses()),
            Err(Skipped::UnauthorizedContract(_))
        ));
        let sepolia = log("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
        assert!(deposit_from_log(&sepolia, BaseNetwork::Sepolia, 200, &addresses()).is_ok());
    }

    #[test]
    fn other_events_removed_logs_and_strangers_are_ignored() {
        let mut removed = usdc_log();
        removed.removed = true;
        assert_eq!(
            deposit_from_log(&removed, BaseNetwork::Mainnet, 200, &addresses()),
            Err(Skipped::NotIncoming)
        );

        let mut stranger = usdc_log();
        stranger.topics[2] = SENDER_TOPIC.to_owned();
        assert_eq!(
            deposit_from_log(&stranger, BaseNetwork::Mainnet, 200, &addresses()),
            Err(Skipped::NotIncoming)
        );

        let mut zero = usdc_log();
        zero.data = format!("0x{}", "0".repeat(64));
        assert_eq!(
            deposit_from_log(&zero, BaseNetwork::Mainnet, 200, &addresses()),
            Err(Skipped::NotIncoming)
        );
    }
}
