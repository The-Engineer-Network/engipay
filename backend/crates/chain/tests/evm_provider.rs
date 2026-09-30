//! Keep this outside the evm module: losing its exports during a merge must
//! fail compilation rather than silently dropping the provider's unit tests.
use engipay_chain::evm::{AlloyProvider, BaseNetwork, ProviderHealth};

#[test]
fn provider_is_accessible_to_chain_consumers() {
    let provider = AlloyProvider::new(BaseNetwork::Sepolia, None).expect("default provider");
    assert_eq!(provider.network().chain_id(), 84_532);
    let health = ProviderHealth {
        chain_id: 84_532,
        block_number: 0,
    };
    assert_eq!(health.chain_id, provider.network().chain_id());
}
