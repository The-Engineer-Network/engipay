#[starknet::contract]
mod AtomiqAdapter {
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

    // Swap status enum
    #[derive(Drop, Serde, starknet::Store)]
    enum SwapStatus {
        Pending,
        Initiated,
        Confirmed,
        Completed,
        Failed,
        Refunded,
    }

    // Cross-chain swap structure
    #[derive(Drop, Serde, starknet::Store)]
    struct AtomiqSwap {
        id: u256,
        user: ContractAddress,
        from_token: ContractAddress,
        to_token: ByteArray, // Bitcoin address or other chain token
        from_amount: u256,
        to_amount: u256,
        fee: u256,
        status: SwapStatus,
        bitcoin_address: ByteArray,
        starknet_tx_hash: felt252,
        bitcoin_tx_hash: ByteArray,
        created_at: u64,
        expires_at: u64,
        settled_at: u64,
    }

    #[storage]
    struct Storage {
        // Swap tracking
        swaps: Map<u256, AtomiqSwap>,
        swap_counter: u256,
        user_swaps: Map<ContractAddress, Array<u256>>,
        
        // Configuration
        owner: ContractAddress,
        fee_recipient: ContractAddress,
        platform_fee: u256, // Fee in basis points (e.g., 50 = 0.5%)
        min_swap_amount: u256,
        max_swap_amount: u256,
        swap_timeout: u64, // Default swap timeout in seconds
        
        // Supported tokens
        supported_tokens: Map<ContractAddress, bool>,
        token_fees: Map<ContractAddress, u256>,
        
        // Emergency controls
        paused: bool,
        emergency_admin: ContractAddress,
        
        // Access control and reentrancy guard components
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        SwapInitiated: SwapInitiated,
        SwapConfirmed: SwapConfirmed,
        SwapCompleted: SwapCompleted,
        SwapFailed: SwapFailed,
        SwapRefunded: SwapRefunded,
        TokenAdded: TokenAdded,
        TokenRemoved: TokenRemoved,
        FeeUpdated: FeeUpdated,
        EmergencyPause: EmergencyPause,
        EmergencyUnpause: EmergencyUnpause,
        #[flat]
        AccessControlEvent: AccessControlComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct SwapInitiated {
        swap_id: u256,
        user: ContractAddress,
        from_token: ContractAddress,
        from_amount: u256,
        to_amount: u256,
        bitcoin_address: ByteArray,
        expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct SwapConfirmed {
        swap_id: u256,
        starknet_tx_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct SwapCompleted {
        swap_id: u256,
        bitcoin_tx_hash: ByteArray,
        settled_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct SwapFailed {
        swap_id: u256,
        reason: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct SwapRefunded {
        swap_id: u256,
        refund_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct TokenAdded {
        token: ContractAddress,
        fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct TokenRemoved {
        token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct FeeUpdated {
        old_fee: u256,
        new_fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct EmergencyPause {
        admin: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct EmergencyUnpause {
        admin: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        fee_recipient: ContractAddress,
        platform_fee: u256,
        swap_timeout: u64
    ) {
        self.owner.write(owner);
        self.fee_recipient.write(fee_recipient);
        self.platform_fee.write(platform_fee);
        self.swap_timeout.write(swap_timeout);
        self.swap_counter.write(0);
        self.paused.write(false);
        self.emergency_admin.write(owner);
        
        // Set up access control
        self.access_control._grant_role(DEFAULT_ADMIN_ROLE, owner);
        self.access_control._grant_role(PAUSER_ROLE, owner);
        
        // Set default limits
        self.min_swap_amount.write(1000000); // 0.01 STRK (18 decimals)
        self.max_swap_amount.write(1000000000000000000000); // 1000 STRK
    }

    #[abi(embed_v0)]
    impl AtomiqAdapterImpl of IAtomiqAdapter<ContractState> {
        /// Initiate a STRK -> BTC swap
        fn initiate_strk_to_btc_swap(
            ref self: ContractState,
            strk_amount: u256,
            bitcoin_address: ByteArray,
            min_btc_amount: u256
        ) -> u256 {
            self._assert_not_paused();
            self.reentrancy_guard._start();
            
            let caller = get_caller_address();
            let current_time = get_block_timestamp();
            
            // Validate inputs
            assert(strk_amount >= self.min_swap_amount.read(), 'Amount too small');
            assert(strk_amount <= self.max_swap_amount.read(), 'Amount too large');
            assert(bitcoin_address.len() > 0, 'Invalid Bitcoin address');
            
            // Calculate fees
            let fee = self._calculate_fee(strk_amount);
            let amount_after_fee = strk_amount - fee;
            
            // Transfer STRK tokens to contract
            let strk_token = self._get_strk_token();
            let strk_dispatcher = IERC20Dispatcher { contract_address: strk_token };
            
            let success = strk_dispatcher.transfer_from(caller, starknet::get_contract_address(), strk_amount);
            assert(success, 'STRK transfer failed');
            
            // Create swap record
            let swap_id = self.swap_counter.read() + 1;
            self.swap_counter.write(swap_id);
            
            let expires_at = current_time + self.swap_timeout.read();
            
            let swap = AtomiqSwap {
                id: swap_id,
                user: caller,
                from_token: strk_token,
                to_token: bitcoin_address.clone(),
                from_amount: strk_amount,
                to_amount: min_btc_amount,
                fee: fee,
                status: SwapStatus::Pending,
                bitcoin_address: bitcoin_address.clone(),
                starknet_tx_hash: 0,
                bitcoin_tx_hash: "",
                created_at: current_time,
                expires_at: expires_at,
                settled_at: 0,
            };
            
            self.swaps.write(swap_id, swap);
            
            // Add to user's swap list
            let mut user_swaps = self.user_swaps.read(caller);
            user_swaps.append(swap_id);
            self.user_swaps.write(caller, user_swaps);
            
            // Transfer fee to fee recipient
            if fee > 0 {
                let fee_success = strk_dispatcher.transfer(self.fee_recipient.read(), fee);
                assert(fee_success, 'Fee transfer failed');
            }
            
            // Emit event
            self.emit(SwapInitiated {
                swap_id: swap_id,
                user: caller,
                from_token: strk_token,
                from_amount: strk_amount,
                to_amount: min_btc_amount,
                bitcoin_address: bitcoin_address,
                expires_at: expires_at,
            });
            
            self.reentrancy_guard._end();
            swap_id
        }

        /// Confirm swap with StarkNet transaction hash
        fn confirm_swap(ref self: ContractState, swap_id: u256, tx_hash: felt252) {
            self._assert_not_paused();
            self.access_control._assert_only_role(DEFAULT_ADMIN_ROLE);
            
            let mut swap = self.swaps.read(swap_id);
            assert(swap.id != 0, 'Swap not found');
            assert(swap.status == SwapStatus::Pending, 'Invalid swap status');
            
            swap.status = SwapStatus::Confirmed;
            swap.starknet_tx_hash = tx_hash;
            self.swaps.write(swap_id, swap);
            
            self.emit(SwapConfirmed {
                swap_id: swap_id,
                starknet_tx_hash: tx_hash,
            });
        }

        /// Complete swap with Bitcoin transaction hash
        fn complete_swap(ref self: ContractState, swap_id: u256, bitcoin_tx_hash: ByteArray) {
            self._assert_not_paused();
            self.access_control._assert_only_role(DEFAULT_ADMIN_ROLE);
            
            let mut swap = self.swaps.read(swap_id);
            assert(swap.id != 0, 'Swap not found');
            assert(swap.status == SwapStatus::Confirmed, 'Invalid swap status');
            
            let current_time = get_block_timestamp();
            
            swap.status = SwapStatus::Completed;
            swap.bitcoin_tx_hash = bitcoin_tx_hash.clone();
            swap.settled_at = current_time;
            self.swaps.write(swap_id, swap);
            
            self.emit(SwapCompleted {
                swap_id: swap_id,
                bitcoin_tx_hash: bitcoin_tx_hash,
                settled_at: current_time,
            });
        }

        /// Refund expired or failed swap
        fn refund_swap(ref self: ContractState, swap_id: u256) {
            self.reentrancy_guard._start();
            
            let mut swap = self.swaps.read(swap_id);
            assert(swap.id != 0, 'Swap not found');
            
            let caller = get_caller_address();
            let current_time = get_block_timestamp();
            
            // Check if caller is authorized to refund
            let is_user = caller == swap.user;
            let is_admin = self.access_control._has_role(DEFAULT_ADMIN_ROLE, caller);
            let is_expired = current_time > swap.expires_at;
            
            assert(is_user || is_admin, 'Unauthorized');
            assert(
                swap.status == SwapStatus::Pending || 
                swap.status == SwapStatus::Failed || 
                (swap.status == SwapStatus::Confirmed && is_expired),
                'Cannot refund'
            );
            
            // Calculate refund amount (original amount minus fee if swap was initiated)
            let refund_amount = if swap.status == SwapStatus::Pending {
                swap.from_amount // Full refund if never processed
            } else {
                swap.from_amount - swap.fee // Partial refund if processed
            };
            
            // Update swap status
            swap.status = SwapStatus::Refunded;
            self.swaps.write(swap_id, swap);
            
            // Transfer refund
            let strk_dispatcher = IERC20Dispatcher { contract_address: swap.from_token };
            let success = strk_dispatcher.transfer(swap.user, refund_amount);
            assert(success, 'Refund transfer failed');
            
            self.emit(SwapRefunded {
                swap_id: swap_id,
                refund_amount: refund_amount,
            });
            
            self.reentrancy_guard._end();
        }

        /// Get swap details
        fn get_swap(self: @ContractState, swap_id: u256) -> AtomiqSwap {
            self.swaps.read(swap_id)
        }

        /// Get user's swaps
        fn get_user_swaps(self: @ContractState, user: ContractAddress) -> Array<u256> {
            self.user_swaps.read(user)
        }

        /// Get swap count
        fn get_swap_count(self: @ContractState) -> u256 {
            self.swap_counter.read()
        }

        /// Admin: Add supported token
        fn add_supported_token(ref self: ContractState, token: ContractAddress, fee: u256) {
            self.access_control._assert_only_role(DEFAULT_ADMIN_ROLE);
            
            self.supported_tokens.write(token, true);
            self.token_fees.write(token, fee);
            
            self.emit(TokenAdded { token: token, fee: fee });
        }

        /// Admin: Remove supported token
        fn remove_supported_token(ref self: ContractState, token: ContractAddress) {
            self.access_control._assert_only_role(DEFAULT_ADMIN_ROLE);
            
            self.supported_tokens.write(token, false);
            
            self.emit(TokenRemoved { token: token });
        }

        /// Admin: Update platform fee
        fn update_platform_fee(ref self: ContractState, new_fee: u256) {
            self.access_control._assert_only_role(DEFAULT_ADMIN_ROLE);
            
            let old_fee = self.platform_fee.read();
            self.platform_fee.write(new_fee);
            
            self.emit(FeeUpdated { old_fee: old_fee, new_fee: new_fee });
        }

        /// Emergency: Pause contract
        fn emergency_pause(ref self: ContractState) {
            self.access_control._assert_only_role(PAUSER_ROLE);
            
            self.paused.write(true);
            
            self.emit(EmergencyPause { admin: get_caller_address() });
        }

        /// Emergency: Unpause contract
        fn emergency_unpause(ref self: ContractState) {
            self.access_control._assert_only_role(PAUSER_ROLE);
            
            self.paused.write(false);
            
            self.emit(EmergencyUnpause { admin: get_caller_address() });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_not_paused(self: @ContractState) {
            assert(!self.paused.read(), 'Contract is paused');
        }

        fn _calculate_fee(self: @ContractState, amount: u256) -> u256 {
            let fee_rate = self.platform_fee.read();
            (amount * fee_rate) / 10000 // Basis points calculation
        }

        fn _get_strk_token(self: @ContractState) -> ContractAddress {
            // Return STRK token contract address
            // This should be set during deployment or configuration
            starknet::contract_address_const::<0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d>()
        }
    }

    #[starknet::interface]
    trait IAtomiqAdapter<TContractState> {
        fn initiate_strk_to_btc_swap(
            ref self: TContractState,
            strk_amount: u256,
            bitcoin_address: ByteArray,
            min_btc_amount: u256
        ) -> u256;
        
        fn confirm_swap(ref self: TContractState, swap_id: u256, tx_hash: felt252);
        fn complete_swap(ref self: TContractState, swap_id: u256, bitcoin_tx_hash: ByteArray);
        fn refund_swap(ref self: TContractState, swap_id: u256);
        
        fn get_swap(self: @TContractState, swap_id: u256) -> AtomiqSwap;
        fn get_user_swaps(self: @TContractState, user: ContractAddress) -> Array<u256>;
        fn get_swap_count(self: @TContractState) -> u256;
        
        fn add_supported_token(ref self: TContractState, token: ContractAddress, fee: u256);
        fn remove_supported_token(ref self: TContractState, token: ContractAddress);
        fn update_platform_fee(ref self: TContractState, new_fee: u256);
        
        fn emergency_pause(ref self: TContractState);
        fn emergency_unpause(ref self: TContractState);
    }
}