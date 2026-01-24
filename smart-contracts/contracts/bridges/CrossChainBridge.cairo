#[starknet::contract]
mod CrossChainBridge {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess
    };
    use super::super::interfaces::IERC20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::super::libraries::SafeMath::{SafeMath, SafeMathTrait};
    use super::super::libraries::AccessControl::{
        AccessControlComponent, DEFAULT_ADMIN_ROLE, PAUSER_ROLE
    };
    use super::super::libraries::ReentrancyGuard::{ReentrancyGuardComponent};

    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl ReentrancyGuardImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    // Transfer status enum
    #[derive(Drop, Serde, starknet::Store)]
    enum TransferStatus {
        Pending,
        Completed,
        Failed,
        Cancelled,
    }

    // Bridge transfer structure
    #[derive(Drop, Serde, starknet::Store)]
    struct BridgeTransfer {
        id: u256,
        sender: ContractAddress,
        recipient: ByteArray, // Cross-chain address (can be different format)
        asset: ContractAddress,
        amount: u256,
        from_chain: u256,
        to_chain: u256,
        fee: u256,
        status: TransferStatus,
        created_at: u64,
        completed_at: u64,
        nonce: u256,
    }

    // Supported chain structure
    #[derive(Drop, Serde, starknet::Store)]
    struct SupportedChain {
        chain_id: u256,
        name: ByteArray,
        active: bool,
        min_transfer: u256,
        max_transfer: u256,
    }

    // Supported asset structure
    #[derive(Drop, Serde, starknet::Store)]
    struct SupportedAsset {
        asset: ContractAddress,
        chain_id: u256,
        active: bool,
        daily_limit: u256,
        daily_transferred: u256,
        last_reset: u64,
    }

    // Storage
    #[storage]
    struct Storage {
        transfers: Map<u256, BridgeTransfer>,
        transfer_counter: u256,
        supported_chains: Map<u256, SupportedChain>,
        supported_assets: Map<(ContractAddress, u256), SupportedAsset>,
        chain_fees: Map<(u256, u256), u256>, // (from_chain, to_chain) -> fee
        validators: Map<ContractAddress, bool>,
        validator_count: u256,
        required_confirmations: u256,
        transfer_confirmations: Map<(u256, ContractAddress), bool>, // (transfer_id, validator) -> confirmed
        transfer_confirmation_count: Map<u256, u256>,
        paused: bool,
        emergency_stop: bool,

        // Components
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    // Events
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        BridgeTransferInitiated: BridgeTransferInitiated,
        BridgeTransferCompleted: BridgeTransferCompleted,
        BridgeTransferFailed: BridgeTransferFailed,
        BridgeTransferCancelled: BridgeTransferCancelled,
        ChainAdded: ChainAdded,
        AssetAdded: AssetAdded,
        ValidatorAdded: ValidatorAdded,
        ValidatorRemoved: ValidatorRemoved,
        TransferConfirmed: TransferConfirmed,
        FeeUpdated: FeeUpdated,
        EmergencyStop: EmergencyStop,
        AccessControlEvent: AccessControlComponent::Event,
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct BridgeTransferInitiated {
        #[key]
        transfer_id: u256,
        #[key]
        sender: ContractAddress,
        recipient: ByteArray,
        asset: ContractAddress,
        amount: u256,
        from_chain: u256,
        to_chain: u256,
        fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct BridgeTransferCompleted {
        #[key]
        transfer_id: u256,
        #[key]
        recipient: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct BridgeTransferFailed {
        #[key]
        transfer_id: u256,
        reason: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct BridgeTransferCancelled {
        #[key]
        transfer_id: u256,
        #[key]
        sender: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct ChainAdded {
        #[key]
        chain_id: u256,
        name: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetAdded {
        #[key]
        asset: ContractAddress,
        #[key]
        chain_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ValidatorAdded {
        #[key]
        validator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct ValidatorRemoved {
        #[key]
        validator: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct TransferConfirmed {
        #[key]
        transfer_id: u256,
        #[key]
        validator: ContractAddress,
        confirmations: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct FeeUpdated {
        from_chain: u256,
        to_chain: u256,
        old_fee: u256,
        new_fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct EmergencyStop {
        stopped: bool,
    }

    // Role constants
    const VALIDATOR_ROLE: felt252 = selector!("VALIDATOR_ROLE");
    const BRIDGE_ADMIN_ROLE: felt252 = selector!("BRIDGE_ADMIN_ROLE");

    mod Errors {
        const ZERO_AMOUNT: felt252 = 'Amount cannot be zero';
        const ZERO_ADDRESS: felt252 = 'Zero address not allowed';
        const UNSUPPORTED_CHAIN: felt252 = 'Chain not supported';
        const UNSUPPORTED_ASSET: felt252 = 'Asset not supported';
        const TRANSFER_NOT_FOUND: felt252 = 'Transfer not found';
        const INVALID_STATUS: felt252 = 'Invalid transfer status';
        const INSUFFICIENT_BALANCE: felt252 = 'Insufficient balance';
        const DAILY_LIMIT_EXCEEDED: felt252 = 'Daily limit exceeded';
        const AMOUNT_TOO_SMALL: felt252 = 'Amount below minimum';
        const AMOUNT_TOO_LARGE: felt252 = 'Amount above maximum';
        const ALREADY_CONFIRMED: felt252 = 'Already confirmed';
        const NOT_VALIDATOR: felt252 = 'Not a validator';
        const CONTRACT_PAUSED: felt252 = 'Contract is paused';
        const EMERGENCY_STOPPED: felt252 = 'Emergency stop active';
        const INSUFFICIENT_CONFIRMATIONS: felt252 = 'Insufficient confirmations';
        const TRANSFER_FAILED: felt252 = 'Transfer failed';
    }

    // Constructor
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        required_confirmations: u256
    ) {
        assert(!owner.is_zero(), Errors::ZERO_ADDRESS);
        assert(required_confirmations > 0, 'Invalid confirmation count');

        self.required_confirmations.write(required_confirmations);
        self.transfer_counter.write(0);
        self.validator_count.write(0);
        self.paused.write(false);
        self.emergency_stop.write(false);

        // Initialize components
        self.access_control.initializer(owner);
        self.reentrancy_guard.initializer();

        // Grant roles to owner
        self.access_control.grant_role(DEFAULT_ADMIN_ROLE, owner);
        self.access_control.grant_role(BRIDGE_ADMIN_ROLE, owner);
        self.access_control.grant_role(PAUSER_ROLE, owner);
    }

    // External functions
    #[abi(embed_v0)]
    impl CrossChainBridgeImpl of ICrossChainBridge<ContractState> {
        fn initiate_bridge_transfer(
            ref self: ContractState,
            from_chain: u256,
            to_chain: u256,
            asset: ContractAddress,
            amount: u256,
            recipient: ByteArray
        ) -> u256 {
            self._assert_not_paused();
            self._assert_not_emergency_stopped();
            assert(amount > 0, Errors::ZERO_AMOUNT);

            // Validate chains and asset
            let from_chain_info = self.supported_chains.read(from_chain);
            let to_chain_info = self.supported_chains.read(to_chain);
            assert(from_chain_info.active, Errors::UNSUPPORTED_CHAIN);
            assert(to_chain_info.active, Errors::UNSUPPORTED_CHAIN);

            let mut asset_info = self.supported_assets.read((asset, to_chain));
            assert(asset_info.active, Errors::UNSUPPORTED_ASSET);

            // Check transfer limits
            assert(amount >= from_chain_info.min_transfer, Errors::AMOUNT_TOO_SMALL);
            assert(amount <= from_chain_info.max_transfer, Errors::AMOUNT_TOO_LARGE);

            // Check daily limits
            self._check_and_update_daily_limit(asset, to_chain, amount);

            self.reentrancy_guard.start();

            // Calculate bridge fee
            let fee = self.get_bridge_fee(from_chain, to_chain, asset);
            let total_amount = SafeMath::add(amount, fee);

            // Transfer tokens from user to bridge
            let token_contract = IERC20Dispatcher { contract_address: asset };
            let sender = get_caller_address();
            
            assert(token_contract.balance_of(sender) >= total_amount, Errors::INSUFFICIENT_BALANCE);
            let success = token_contract.transfer_from(sender, starknet::get_contract_address(), total_amount);
            assert(success, Errors::TRANSFER_FAILED);

            // Create transfer record
            let transfer_id = self.transfer_counter.read() + 1;
            self.transfer_counter.write(transfer_id);

            let transfer = BridgeTransfer {
                id: transfer_id,
                sender,
                recipient,
                asset,
                amount,
                from_chain,
                to_chain,
                fee,
                status: TransferStatus::Pending,
                created_at: get_block_timestamp(),
                completed_at: 0,
                nonce: transfer_id, // Simple nonce for now
            };

            self.transfers.write(transfer_id, transfer);

            self.emit(BridgeTransferInitiated {
                transfer_id,
                sender,
                recipient,
                asset,
                amount,
                from_chain,
                to_chain,
                fee,
            });

            self.reentrancy_guard.end();
            transfer_id
        }

        fn complete_bridge_transfer(ref self: ContractState, transfer_id: u256, proof: Array<felt252>) -> bool {
            self._assert_not_paused();
            self.access_control.assert_only_role(VALIDATOR_ROLE);

            let mut transfer = self.transfers.read(transfer_id);
            assert(transfer.id != 0, Errors::TRANSFER_NOT_FOUND);
            assert(transfer.status == TransferStatus::Pending, Errors::INVALID_STATUS);

            // Check if validator already confirmed
            let validator = get_caller_address();
            assert(!self.transfer_confirmations.read((transfer_id, validator)), Errors::ALREADY_CONFIRMED);

            // Record confirmation
            self.transfer_confirmations.write((transfer_id, validator), true);
            let confirmations = self.transfer_confirmation_count.read(transfer_id) + 1;
            self.transfer_confirmation_count.write(transfer_id, confirmations);

            self.emit(TransferConfirmed { transfer_id, validator, confirmations });

            // Check if we have enough confirmations
            if confirmations >= self.required_confirmations.read() {
                // Complete the transfer
                transfer.status = TransferStatus::Completed;
                transfer.completed_at = get_block_timestamp();
                self.transfers.write(transfer_id, transfer);

                // In a real implementation, this would trigger the transfer on the destination chain
                // For now, we just emit an event
                self.emit(BridgeTransferCompleted {
                    transfer_id,
                    recipient: transfer.sender, // Placeholder - would be parsed from recipient field
                    amount: transfer.amount,
                });

                return true;
            }

            false
        }

        fn cancel_transfer(ref self: ContractState, transfer_id: u256) -> bool {
            self._assert_not_paused();

            let mut transfer = self.transfers.read(transfer_id);
            assert(transfer.id != 0, Errors::TRANSFER_NOT_FOUND);
            assert(transfer.sender == get_caller_address(), 'Only sender can cancel');
            assert(transfer.status == TransferStatus::Pending, Errors::INVALID_STATUS);

            self.reentrancy_guard.start();

            // Update status
            transfer.status = TransferStatus::Cancelled;
            self.transfers.write(transfer_id, transfer);

            // Refund tokens to sender
            let token_contract = IERC20Dispatcher { contract_address: transfer.asset };
            let refund_amount = SafeMath::add(transfer.amount, transfer.fee);
            let success = token_contract.transfer(transfer.sender, refund_amount);
            assert(success, Errors::TRANSFER_FAILED);

            self.emit(BridgeTransferCancelled { transfer_id, sender: transfer.sender });

            self.reentrancy_guard.end();
            true
        }

        // View functions
        fn get_bridge_fee(self: @ContractState, from_chain: u256, to_chain: u256, asset: ContractAddress) -> u256 {
            self.chain_fees.read((from_chain, to_chain))
        }

        fn get_transfer_status(self: @ContractState, transfer_id: u256) -> TransferStatus {
            let transfer = self.transfers.read(transfer_id);
            transfer.status
        }

        fn get_transfer_details(self: @ContractState, transfer_id: u256) -> BridgeTransfer {
            self.transfers.read(transfer_id)
        }

        fn get_supported_chains(self: @ContractState) -> Array<u256> {
            // In a real implementation, this would iterate through all supported chains
            // For now, return empty array
            ArrayTrait::new()
        }

        fn is_chain_supported(self: @ContractState, chain_id: u256) -> bool {
            let chain = self.supported_chains.read(chain_id);
            chain.active
        }

        fn is_asset_supported(self: @ContractState, asset: ContractAddress, chain_id: u256) -> bool {
            let asset_info = self.supported_assets.read((asset, chain_id));
            asset_info.active
        }

        // Admin functions
        fn add_supported_chain(
            ref self: ContractState,
            chain_id: u256,
            name: ByteArray,
            min_transfer: u256,
            max_transfer: u256
        ) {
            self.access_control.assert_only_role(BRIDGE_ADMIN_ROLE);

            let chain = SupportedChain {
                chain_id,
                name: name.clone(),
                active: true,
                min_transfer,
                max_transfer,
            };

            self.supported_chains.write(chain_id, chain);
            self.emit(ChainAdded { chain_id, name });
        }

        fn add_supported_asset(
            ref self: ContractState,
            asset: ContractAddress,
            chain_id: u256,
            daily_limit: u256
        ) {
            self.access_control.assert_only_role(BRIDGE_ADMIN_ROLE);
            assert(!asset.is_zero(), Errors::ZERO_ADDRESS);

            let asset_info = SupportedAsset {
                asset,
                chain_id,
                active: true,
                daily_limit,
                daily_transferred: 0,
                last_reset: get_block_timestamp(),
            };

            self.supported_assets.write((asset, chain_id), asset_info);
            self.emit(AssetAdded { asset, chain_id });
        }

        fn add_validator(ref self: ContractState, validator: ContractAddress) {
            self.access_control.assert_only_role(BRIDGE_ADMIN_ROLE);
            assert(!validator.is_zero(), Errors::ZERO_ADDRESS);

            self.validators.write(validator, true);
            self.access_control.grant_role(VALIDATOR_ROLE, validator);
            
            let count = self.validator_count.read();
            self.validator_count.write(count + 1);

            self.emit(ValidatorAdded { validator });
        }

        fn remove_validator(ref self: ContractState, validator: ContractAddress) {
            self.access_control.assert_only_role(BRIDGE_ADMIN_ROLE);

            self.validators.write(validator, false);
            self.access_control.revoke_role(VALIDATOR_ROLE, validator);
            
            let count = self.validator_count.read();
            if count > 0 {
                self.validator_count.write(count - 1);
            }

            self.emit(ValidatorRemoved { validator });
        }

        fn update_bridge_fee(ref self: ContractState, from_chain: u256, to_chain: u256, new_fee: u256) {
            self.access_control.assert_only_role(BRIDGE_ADMIN_ROLE);

            let old_fee = self.chain_fees.read((from_chain, to_chain));
            self.chain_fees.write((from_chain, to_chain), new_fee);

            self.emit(FeeUpdated { from_chain, to_chain, old_fee, new_fee });
        }

        fn emergency_stop(ref self: ContractState, stop: bool) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            self.emergency_stop.write(stop);
            self.emit(EmergencyStop { stopped: stop });
        }

        fn pause(ref self: ContractState) {
            self.access_control.assert_only_role(PAUSER_ROLE);
            self.paused.write(true);
        }

        fn unpause(ref self: ContractState) {
            self.access_control.assert_only_role(PAUSER_ROLE);
            self.paused.write(false);
        }
    }

    // Internal functions
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_not_paused(self: @ContractState) {
            assert(!self.paused.read(), Errors::CONTRACT_PAUSED);
        }

        fn _assert_not_emergency_stopped(self: @ContractState) {
            assert(!self.emergency_stop.read(), Errors::EMERGENCY_STOPPED);
        }

        fn _check_and_update_daily_limit(
            ref self: ContractState,
            asset: ContractAddress,
            chain_id: u256,
            amount: u256
        ) {
            let mut asset_info = self.supported_assets.read((asset, chain_id));
            let current_time = get_block_timestamp();
            
            // Reset daily limit if a day has passed
            if current_time >= asset_info.last_reset + 86400 { // 24 hours
                asset_info.daily_transferred = 0;
                asset_info.last_reset = current_time;
            }

            // Check if adding this amount would exceed daily limit
            let new_daily_total = SafeMath::add(asset_info.daily_transferred, amount);
            assert(new_daily_total <= asset_info.daily_limit, Errors::DAILY_LIMIT_EXCEEDED);

            // Update daily transferred amount
            asset_info.daily_transferred = new_daily_total;
            self.supported_assets.write((asset, chain_id), asset_info);
        }
    }
}

#[starknet::interface]
trait ICrossChainBridge<TContractState> {
    fn initiate_bridge_transfer(
        ref self: TContractState,
        from_chain: u256,
        to_chain: u256,
        asset: ContractAddress,
        amount: u256,
        recipient: ByteArray
    ) -> u256;
    fn complete_bridge_transfer(ref self: TContractState, transfer_id: u256, proof: Array<felt252>) -> bool;
    fn cancel_transfer(ref self: TContractState, transfer_id: u256) -> bool;
    fn get_bridge_fee(self: @TContractState, from_chain: u256, to_chain: u256, asset: ContractAddress) -> u256;
    fn get_transfer_status(self: @TContractState, transfer_id: u256) -> CrossChainBridge::TransferStatus;
    fn get_transfer_details(self: @TContractState, transfer_id: u256) -> CrossChainBridge::BridgeTransfer;
    fn get_supported_chains(self: @TContractState) -> Array<u256>;
    fn is_chain_supported(self: @TContractState, chain_id: u256) -> bool;
    fn is_asset_supported(self: @TContractState, asset: ContractAddress, chain_id: u256) -> bool;
    fn add_supported_chain(ref self: TContractState, chain_id: u256, name: ByteArray, min_transfer: u256, max_transfer: u256);
    fn add_supported_asset(ref self: TContractState, asset: ContractAddress, chain_id: u256, daily_limit: u256);
    fn add_validator(ref self: TContractState, validator: ContractAddress);
    fn remove_validator(ref self: TContractState, validator: ContractAddress);
    fn update_bridge_fee(ref self: TContractState, from_chain: u256, to_chain: u256, new_fee: u256);
    fn emergency_stop(ref self: TContractState, stop: bool);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
}