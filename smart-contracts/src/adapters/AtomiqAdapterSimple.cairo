#[starknet::contract]
pub mod AtomiqAdapterSimple {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess
    };
    use engipay_contracts::interfaces::IERC20::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[derive(Drop, Serde, starknet::Store, Copy)]
    #[allow(starknet::store_no_default_variant)]
    pub enum SwapStatus {
        Pending,
        Confirmed,
        Completed,
        Failed,
        Refunded,
    }

    #[derive(Drop, Serde, starknet::Store, Copy)]
    pub struct AtomiqSwap {
        pub id: u256,
        pub user: ContractAddress,
        pub from_token: ContractAddress,
        pub from_amount: u256,
        pub to_amount: u256,
        pub fee: u256,
        pub status: SwapStatus,
        pub created_at: u64,
        pub expires_at: u64,
    }

    #[storage]
    struct Storage {
        swaps: Map<u256, AtomiqSwap>,
        swap_counter: u256,
        owner: ContractAddress,
        fee_recipient: ContractAddress,
        platform_fee: u256,
        swap_timeout: u64,
        paused: bool,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        SwapInitiated: SwapInitiated,
        SwapConfirmed: SwapConfirmed,
        SwapCompleted: SwapCompleted,
        SwapRefunded: SwapRefunded,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapInitiated {
        pub swap_id: u256,
        pub user: ContractAddress,
        pub from_amount: u256,
        pub to_amount: u256,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapConfirmed {
        pub swap_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapCompleted {
        pub swap_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SwapRefunded {
        pub swap_id: u256,
        pub refund_amount: u256,
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
    }

    #[starknet::interface]
    trait IAtomiqAdapter<TContractState> {
        fn initiate_swap(
            ref self: TContractState,
            strk_amount: u256,
            min_btc_amount: u256,
            strk_token: ContractAddress
        ) -> u256;
        fn confirm_swap(ref self: TContractState, swap_id: u256);
        fn complete_swap(ref self: TContractState, swap_id: u256);
        fn refund_swap(ref self: TContractState, swap_id: u256);
        fn get_swap(self: @TContractState, swap_id: u256) -> AtomiqSwap;
        fn get_swap_count(self: @TContractState) -> u256;
        fn update_platform_fee(ref self: TContractState, new_fee: u256);
        fn pause(ref self: TContractState);
        fn unpause(ref self: TContractState);
    }

    #[abi(embed_v0)]
    impl AtomiqAdapterImpl of IAtomiqAdapter<ContractState> {
        fn initiate_swap(
            ref self: ContractState,
            strk_amount: u256,
            min_btc_amount: u256,
            strk_token: ContractAddress
        ) -> u256 {
            assert(!self.paused.read(), 'paused');
            assert(strk_amount > 0, 'zero amount');
            
            let caller = get_caller_address();
            let current_time = get_block_timestamp();
            
            let platform_fee = self.platform_fee.read();
            let fee = (strk_amount * platform_fee) / 10000;
            
            let strk_dispatcher = IERC20Dispatcher { contract_address: strk_token };
            let success = strk_dispatcher.transfer_from(caller, starknet::get_contract_address(), strk_amount);
            assert(success, 'transfer failed');
            
            let swap_id = self.swap_counter.read() + 1;
            self.swap_counter.write(swap_id);
            
            let expires_at = current_time + self.swap_timeout.read();
            
            let swap = AtomiqSwap {
                id: swap_id,
                user: caller,
                from_token: strk_token,
                from_amount: strk_amount,
                to_amount: min_btc_amount,
                fee,
                status: SwapStatus::Pending,
                created_at: current_time,
                expires_at,
            };
            
            self.swaps.write(swap_id, swap);
            
            if fee > 0_u256 {
                let fee_success = strk_dispatcher.transfer(self.fee_recipient.read(), fee);
                assert(fee_success, 'fee transfer failed');
            }
            
            self.emit(SwapInitiated {
                swap_id,
                user: caller,
                from_amount: strk_amount,
                to_amount: min_btc_amount,
                expires_at,
            });
            
            swap_id
        }

        fn confirm_swap(ref self: ContractState, swap_id: u256) {
            assert(get_caller_address() == self.owner.read(), 'only owner');
            
            let swap = self.swaps.read(swap_id);
            assert(swap.id != 0, 'not found');

            let mut updated_swap = swap;
            updated_swap.status = SwapStatus::Confirmed;
            self.swaps.write(swap_id, updated_swap);
            
            self.emit(SwapConfirmed { swap_id });
        }

        fn complete_swap(ref self: ContractState, swap_id: u256) {
            assert(get_caller_address() == self.owner.read(), 'only owner');
            
            let swap = self.swaps.read(swap_id);
            assert(swap.id != 0, 'not found');

            let mut updated_swap = swap;
            updated_swap.status = SwapStatus::Completed;
            self.swaps.write(swap_id, updated_swap);
            
            self.emit(SwapCompleted { swap_id });
        }

        fn refund_swap(ref self: ContractState, swap_id: u256) {
            let swap = self.swaps.read(swap_id);
            assert(swap.id != 0, 'not found');
            
            let caller = get_caller_address();
            let is_owner = caller == self.owner.read();
            let is_user = caller == swap.user;
            
            assert(is_owner || is_user, 'unauthorized');

            let from_token = swap.from_token;
            let user = swap.user;
            let from_amount = swap.from_amount;
            let fee = swap.fee;
            let refund_amount = from_amount - fee;
            
            let mut updated_swap = swap;
            updated_swap.status = SwapStatus::Refunded;
            self.swaps.write(swap_id, updated_swap);
            
            let strk_dispatcher = IERC20Dispatcher { contract_address: from_token };
            let success = strk_dispatcher.transfer(user, refund_amount);
            assert(success, 'refund failed');
            
            self.emit(SwapRefunded { swap_id, refund_amount });
        }

        fn get_swap(self: @ContractState, swap_id: u256) -> AtomiqSwap {
            self.swaps.read(swap_id)
        }

        fn get_swap_count(self: @ContractState) -> u256 {
            self.swap_counter.read()
        }

        fn update_platform_fee(ref self: ContractState, new_fee: u256) {
            assert(get_caller_address() == self.owner.read(), 'only owner');
            self.platform_fee.write(new_fee);
        }

        fn pause(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'only owner');
            self.paused.write(true);
        }

        fn unpause(ref self: ContractState) {
            assert(get_caller_address() == self.owner.read(), 'only owner');
            self.paused.write(false);
        }
    }
}
