#[starknet::contract]
mod Treasury {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
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

    // Fee structure
    #[derive(Drop, Serde, starknet::Store)]
    struct FeeRates {
        payment_fee: u256,    // Basis points (e.g., 50 = 0.5%)
        swap_fee: u256,       // Basis points
        defi_fee: u256,       // Basis points
        withdrawal_fee: u256, // Basis points
    }

    // Treasury allocation
    #[derive(Drop, Serde, starknet::Store)]
    struct AllocationRates {
        development: u256,    // Percentage of fees for development
        marketing: u256,      // Percentage of fees for marketing
        operations: u256,     // Percentage of fees for operations
        reserves: u256,       // Percentage of fees for reserves
        rewards: u256,        // Percentage of fees for user rewards
    }

    // Storage
    #[storage]
    struct Storage {
        treasury_balances: Map<ContractAddress, u256>,
        fee_rates: FeeRates,
        allocation_rates: AllocationRates,
        allocated_funds: Map<(ContractAddress, u8), u256>, // (token, allocation_type) -> amount
        total_fees_collected: Map<ContractAddress, u256>,
        authorized_collectors: Map<ContractAddress, bool>,
        paused: bool,

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
        FeesDeposited: FeesDeposited,
        FundsWithdrawn: FundsWithdrawn,
        RewardsDistributed: RewardsDistributed,
        FeeRatesUpdated: FeeRatesUpdated,
        AllocationRatesUpdated: AllocationRatesUpdated,
        CollectorAuthorized: CollectorAuthorized,
        CollectorRevoked: CollectorRevoked,
        AccessControlEvent: AccessControlComponent::Event,
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct FeesDeposited {
        #[key]
        token: ContractAddress,
        #[key]
        collector: ContractAddress,
        amount: u256,
        fee_type: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct FundsWithdrawn {
        #[key]
        token: ContractAddress,
        #[key]
        recipient: ContractAddress,
        amount: u256,
        allocation_type: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct RewardsDistributed {
        #[key]
        token: ContractAddress,
        total_amount: u256,
        recipient_count: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct FeeRatesUpdated {
        payment_fee: u256,
        swap_fee: u256,
        defi_fee: u256,
        withdrawal_fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct AllocationRatesUpdated {
        development: u256,
        marketing: u256,
        operations: u256,
        reserves: u256,
        rewards: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct CollectorAuthorized {
        #[key]
        collector: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct CollectorRevoked {
        #[key]
        collector: ContractAddress,
    }

    // Constants for allocation types
    const ALLOCATION_DEVELOPMENT: u8 = 0;
    const ALLOCATION_MARKETING: u8 = 1;
    const ALLOCATION_OPERATIONS: u8 = 2;
    const ALLOCATION_RESERVES: u8 = 3;
    const ALLOCATION_REWARDS: u8 = 4;

    // Constants for fee types
    const FEE_TYPE_PAYMENT: u8 = 0;
    const FEE_TYPE_SWAP: u8 = 1;
    const FEE_TYPE_DEFI: u8 = 2;
    const FEE_TYPE_WITHDRAWAL: u8 = 3;

    mod Errors {
        const UNAUTHORIZED_COLLECTOR: felt252 = 'Unauthorized fee collector';
        const ZERO_AMOUNT: felt252 = 'Amount cannot be zero';
        const ZERO_ADDRESS: felt252 = 'Zero address not allowed';
        const INSUFFICIENT_BALANCE: felt252 = 'Insufficient treasury balance';
        const INVALID_ALLOCATION: felt252 = 'Invalid allocation rates';
        const INVALID_FEE_RATE: felt252 = 'Invalid fee rate';
        const CONTRACT_PAUSED: felt252 = 'Contract is paused';
        const TRANSFER_FAILED: felt252 = 'Token transfer failed';
        const ARRAY_LENGTH_MISMATCH: felt252 = 'Array length mismatch';
    }

    // Constructor
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        initial_fee_rates: FeeRates,
        initial_allocation_rates: AllocationRates
    ) {
        assert(!owner.is_zero(), Errors::ZERO_ADDRESS);
        self._validate_allocation_rates(@initial_allocation_rates);

        self.fee_rates.write(initial_fee_rates);
        self.allocation_rates.write(initial_allocation_rates);
        self.paused.write(false);

        // Initialize components
        self.access_control.initializer(owner);
        self.reentrancy_guard.initializer();

        // Grant roles to owner
        self.access_control.grant_role(DEFAULT_ADMIN_ROLE, owner);
        self.access_control.grant_role(PAUSER_ROLE, owner);
    }

    // External functions
    #[abi(embed_v0)]
    impl TreasuryImpl of ITreasury<ContractState> {
        fn deposit_fees(ref self: ContractState, token: ContractAddress, amount: u256, fee_type: u8) {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);
            assert(self.authorized_collectors.read(get_caller_address()), Errors::UNAUTHORIZED_COLLECTOR);

            self.reentrancy_guard.start();

            // Transfer tokens to treasury
            let token_contract = IERC20Dispatcher { contract_address: token };
            let success = token_contract.transfer_from(get_caller_address(), starknet::get_contract_address(), amount);
            assert(success, Errors::TRANSFER_FAILED);

            // Update treasury balance
            let current_balance = self.treasury_balances.read(token);
            self.treasury_balances.write(token, SafeMath::add(current_balance, amount));

            // Update total fees collected
            let total_fees = self.total_fees_collected.read(token);
            self.total_fees_collected.write(token, SafeMath::add(total_fees, amount));

            // Allocate funds according to allocation rates
            self._allocate_funds(token, amount);

            self.emit(FeesDeposited {
                token,
                collector: get_caller_address(),
                amount,
                fee_type,
            });

            self.reentrancy_guard.end();
        }

        fn withdraw_funds(
            ref self: ContractState,
            token: ContractAddress,
            amount: u256,
            recipient: ContractAddress,
            allocation_type: u8
        ) -> bool {
            self._assert_not_paused();
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(amount > 0, Errors::ZERO_AMOUNT);
            assert(!recipient.is_zero(), Errors::ZERO_ADDRESS);

            self.reentrancy_guard.start();

            // Check allocated funds
            let allocated_amount = self.allocated_funds.read((token, allocation_type));
            assert(allocated_amount >= amount, Errors::INSUFFICIENT_BALANCE);

            // Update allocated funds
            self.allocated_funds.write((token, allocation_type), SafeMath::sub(allocated_amount, amount));

            // Update treasury balance
            let current_balance = self.treasury_balances.read(token);
            self.treasury_balances.write(token, SafeMath::sub(current_balance, amount));

            // Transfer tokens to recipient
            let token_contract = IERC20Dispatcher { contract_address: token };
            let success = token_contract.transfer(recipient, amount);
            assert(success, Errors::TRANSFER_FAILED);

            self.emit(FundsWithdrawn {
                token,
                recipient,
                amount,
                allocation_type,
            });

            self.reentrancy_guard.end();
            true
        }

        fn distribute_rewards(
            ref self: ContractState,
            recipients: Array<ContractAddress>,
            amounts: Array<u256>,
            token: ContractAddress
        ) {
            self._assert_not_paused();
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(recipients.len() == amounts.len(), Errors::ARRAY_LENGTH_MISMATCH);

            self.reentrancy_guard.start();

            let mut total_amount = 0;
            let mut i = 0;

            // Calculate total amount needed
            loop {
                if i >= amounts.len() {
                    break;
                }
                total_amount = SafeMath::add(total_amount, *amounts.at(i));
                i += 1;
            };

            // Check if we have enough allocated rewards
            let allocated_rewards = self.allocated_funds.read((token, ALLOCATION_REWARDS));
            assert(allocated_rewards >= total_amount, Errors::INSUFFICIENT_BALANCE);

            // Update allocated rewards
            self.allocated_funds.write((token, ALLOCATION_REWARDS), SafeMath::sub(allocated_rewards, total_amount));

            // Update treasury balance
            let current_balance = self.treasury_balances.read(token);
            self.treasury_balances.write(token, SafeMath::sub(current_balance, total_amount));

            // Distribute rewards
            let token_contract = IERC20Dispatcher { contract_address: token };
            i = 0;
            loop {
                if i >= recipients.len() {
                    break;
                }
                let recipient = *recipients.at(i);
                let amount = *amounts.at(i);
                
                let success = token_contract.transfer(recipient, amount);
                assert(success, Errors::TRANSFER_FAILED);
                
                i += 1;
            };

            self.emit(RewardsDistributed {
                token,
                total_amount,
                recipient_count: recipients.len().into(),
            });

            self.reentrancy_guard.end();
        }

        // View functions
        fn get_treasury_balance(self: @ContractState, token: ContractAddress) -> u256 {
            self.treasury_balances.read(token)
        }

        fn get_allocated_funds(self: @ContractState, token: ContractAddress, allocation_type: u8) -> u256 {
            self.allocated_funds.read((token, allocation_type))
        }

        fn get_fee_rates(self: @ContractState) -> FeeRates {
            self.fee_rates.read()
        }

        fn get_allocation_rates(self: @ContractState) -> AllocationRates {
            self.allocation_rates.read()
        }

        fn get_total_fees_collected(self: @ContractState, token: ContractAddress) -> u256 {
            self.total_fees_collected.read(token)
        }

        fn is_authorized_collector(self: @ContractState, collector: ContractAddress) -> bool {
            self.authorized_collectors.read(collector)
        }

        // Admin functions
        fn set_fee_rates(
            ref self: ContractState,
            payment_fee: u256,
            swap_fee: u256,
            defi_fee: u256,
            withdrawal_fee: u256
        ) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            
            // Validate fee rates (max 10% each)
            assert(payment_fee <= 1000, Errors::INVALID_FEE_RATE);
            assert(swap_fee <= 1000, Errors::INVALID_FEE_RATE);
            assert(defi_fee <= 1000, Errors::INVALID_FEE_RATE);
            assert(withdrawal_fee <= 1000, Errors::INVALID_FEE_RATE);

            let new_rates = FeeRates {
                payment_fee,
                swap_fee,
                defi_fee,
                withdrawal_fee,
            };

            self.fee_rates.write(new_rates);

            self.emit(FeeRatesUpdated {
                payment_fee,
                swap_fee,
                defi_fee,
                withdrawal_fee,
            });
        }

        fn set_allocation_rates(ref self: ContractState, new_rates: AllocationRates) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            self._validate_allocation_rates(@new_rates);

            self.allocation_rates.write(new_rates);

            self.emit(AllocationRatesUpdated {
                development: new_rates.development,
                marketing: new_rates.marketing,
                operations: new_rates.operations,
                reserves: new_rates.reserves,
                rewards: new_rates.rewards,
            });
        }

        fn authorize_collector(ref self: ContractState, collector: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(!collector.is_zero(), Errors::ZERO_ADDRESS);

            self.authorized_collectors.write(collector, true);
            self.emit(CollectorAuthorized { collector });
        }

        fn revoke_collector(ref self: ContractState, collector: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);

            self.authorized_collectors.write(collector, false);
            self.emit(CollectorRevoked { collector });
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

        fn _validate_allocation_rates(self: @ContractState, rates: @AllocationRates) {
            let total = SafeMath::add(
                SafeMath::add(
                    SafeMath::add(*rates.development, *rates.marketing),
                    SafeMath::add(*rates.operations, *rates.reserves)
                ),
                *rates.rewards
            );
            assert(total == 100, Errors::INVALID_ALLOCATION); // Must sum to 100%
        }

        fn _allocate_funds(ref self: ContractState, token: ContractAddress, amount: u256) {
            let rates = self.allocation_rates.read();

            // Calculate allocations
            let dev_allocation = SafeMath::div(SafeMath::mul(amount, rates.development), 100);
            let marketing_allocation = SafeMath::div(SafeMath::mul(amount, rates.marketing), 100);
            let ops_allocation = SafeMath::div(SafeMath::mul(amount, rates.operations), 100);
            let reserves_allocation = SafeMath::div(SafeMath::mul(amount, rates.reserves), 100);
            let rewards_allocation = SafeMath::div(SafeMath::mul(amount, rates.rewards), 100);

            // Update allocated funds
            self._update_allocation(token, ALLOCATION_DEVELOPMENT, dev_allocation);
            self._update_allocation(token, ALLOCATION_MARKETING, marketing_allocation);
            self._update_allocation(token, ALLOCATION_OPERATIONS, ops_allocation);
            self._update_allocation(token, ALLOCATION_RESERVES, reserves_allocation);
            self._update_allocation(token, ALLOCATION_REWARDS, rewards_allocation);
        }

        fn _update_allocation(ref self: ContractState, token: ContractAddress, allocation_type: u8, amount: u256) {
            let current = self.allocated_funds.read((token, allocation_type));
            self.allocated_funds.write((token, allocation_type), SafeMath::add(current, amount));
        }
    }
}

#[starknet::interface]
trait ITreasury<TContractState> {
    fn deposit_fees(ref self: TContractState, token: ContractAddress, amount: u256, fee_type: u8);
    fn withdraw_funds(
        ref self: TContractState,
        token: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
        allocation_type: u8
    ) -> bool;
    fn distribute_rewards(
        ref self: TContractState,
        recipients: Array<ContractAddress>,
        amounts: Array<u256>,
        token: ContractAddress
    );
    fn get_treasury_balance(self: @TContractState, token: ContractAddress) -> u256;
    fn get_allocated_funds(self: @TContractState, token: ContractAddress, allocation_type: u8) -> u256;
    fn get_fee_rates(self: @TContractState) -> Treasury::FeeRates;
    fn get_allocation_rates(self: @TContractState) -> Treasury::AllocationRates;
    fn get_total_fees_collected(self: @TContractState, token: ContractAddress) -> u256;
    fn is_authorized_collector(self: @TContractState, collector: ContractAddress) -> bool;
    fn set_fee_rates(ref self: TContractState, payment_fee: u256, swap_fee: u256, defi_fee: u256, withdrawal_fee: u256);
    fn set_allocation_rates(ref self: TContractState, new_rates: Treasury::AllocationRates);
    fn authorize_collector(ref self: TContractState, collector: ContractAddress);
    fn revoke_collector(ref self: TContractState, collector: ContractAddress);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
}