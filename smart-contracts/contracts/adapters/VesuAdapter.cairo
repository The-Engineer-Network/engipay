#[starknet::contract]
mod VesuAdapter {
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

    // Lending position structure
    #[derive(Drop, Serde, starknet::Store)]
    struct LendingPosition {
        user: ContractAddress,
        asset: ContractAddress,
        amount: u256,
        shares: u256,
        timestamp: u64,
    }

    // Borrowing position structure
    #[derive(Drop, Serde, starknet::Store)]
    struct BorrowingPosition {
        user: ContractAddress,
        collateral_asset: ContractAddress,
        borrow_asset: ContractAddress,
        collateral_amount: u256,
        borrowed_amount: u256,
        timestamp: u64,
    }

    // Storage
    #[storage]
    struct Storage {
        vesu_protocol: ContractAddress,
        lending_positions: Map<(ContractAddress, ContractAddress), LendingPosition>,
        borrowing_positions: Map<(ContractAddress, ContractAddress), BorrowingPosition>,
        supported_assets: Map<ContractAddress, bool>,
        asset_lending_rates: Map<ContractAddress, u256>,
        asset_borrowing_rates: Map<ContractAddress, u256>,
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
        AssetLent: AssetLent,
        AssetWithdrawn: AssetWithdrawn,
        AssetBorrowed: AssetBorrowed,
        AssetRepaid: AssetRepaid,
        AssetAdded: AssetAdded,
        RatesUpdated: RatesUpdated,
        AccessControlEvent: AccessControlComponent::Event,
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetLent {
        #[key]
        user: ContractAddress,
        #[key]
        asset: ContractAddress,
        amount: u256,
        shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetWithdrawn {
        #[key]
        user: ContractAddress,
        #[key]
        asset: ContractAddress,
        amount: u256,
        shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetBorrowed {
        #[key]
        user: ContractAddress,
        #[key]
        collateral_asset: ContractAddress,
        #[key]
        borrow_asset: ContractAddress,
        collateral_amount: u256,
        borrowed_amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetRepaid {
        #[key]
        user: ContractAddress,
        #[key]
        asset: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct AssetAdded {
        #[key]
        asset: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct RatesUpdated {
        #[key]
        asset: ContractAddress,
        lending_rate: u256,
        borrowing_rate: u256,
    }

    mod Errors {
        const UNSUPPORTED_ASSET: felt252 = 'Asset not supported';
        const INSUFFICIENT_BALANCE: felt252 = 'Insufficient balance';
        const INSUFFICIENT_COLLATERAL: felt252 = 'Insufficient collateral';
        const POSITION_NOT_FOUND: felt252 = 'Position not found';
        const ZERO_AMOUNT: felt252 = 'Amount cannot be zero';
        const ZERO_ADDRESS: felt252 = 'Zero address not allowed';
        const CONTRACT_PAUSED: felt252 = 'Contract is paused';
        const HEALTH_FACTOR_TOO_LOW: felt252 = 'Health factor too low';
    }

    // Constructor
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        vesu_protocol: ContractAddress
    ) {
        assert(!owner.is_zero(), Errors::ZERO_ADDRESS);
        assert(!vesu_protocol.is_zero(), Errors::ZERO_ADDRESS);

        self.vesu_protocol.write(vesu_protocol);
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
    impl VesuAdapterImpl of IVesuAdapter<ContractState> {
        fn lend_asset(ref self: ContractState, asset: ContractAddress, amount: u256) -> u256 {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);
            assert(self.supported_assets.read(asset), Errors::UNSUPPORTED_ASSET);

            self.reentrancy_guard.start();

            let user = get_caller_address();
            let token_contract = IERC20Dispatcher { contract_address: asset };

            // Check user balance and allowance
            assert(token_contract.balance_of(user) >= amount, Errors::INSUFFICIENT_BALANCE);
            assert(
                token_contract.allowance(user, starknet::get_contract_address()) >= amount,
                'Insufficient allowance'
            );

            // Transfer tokens from user to contract
            let success = token_contract.transfer_from(user, starknet::get_contract_address(), amount);
            assert(success, 'Transfer failed');

            // Calculate shares (simplified - in real implementation, this would interact with Vesu)
            let shares = self._calculate_lending_shares(asset, amount);

            // Update or create lending position
            let mut position = self.lending_positions.read((user, asset));
            position.user = user;
            position.asset = asset;
            position.amount = SafeMath::add(position.amount, amount);
            position.shares = SafeMath::add(position.shares, shares);
            position.timestamp = starknet::get_block_timestamp();

            self.lending_positions.write((user, asset), position);

            self.emit(AssetLent { user, asset, amount, shares });

            self.reentrancy_guard.end();
            shares
        }

        fn withdraw_lent_asset(ref self: ContractState, asset: ContractAddress, amount: u256) -> u256 {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);

            self.reentrancy_guard.start();

            let user = get_caller_address();
            let mut position = self.lending_positions.read((user, asset));
            assert(position.amount >= amount, Errors::INSUFFICIENT_BALANCE);

            // Calculate shares to burn
            let shares_to_burn = self._calculate_shares_to_burn(asset, amount, position.shares, position.amount);

            // Update position
            position.amount = SafeMath::sub(position.amount, amount);
            position.shares = SafeMath::sub(position.shares, shares_to_burn);
            self.lending_positions.write((user, asset), position);

            // Transfer tokens back to user (including accrued interest)
            let withdrawal_amount = self._calculate_withdrawal_amount(asset, amount);
            let token_contract = IERC20Dispatcher { contract_address: asset };
            let success = token_contract.transfer(user, withdrawal_amount);
            assert(success, 'Transfer failed');

            self.emit(AssetWithdrawn { user, asset, amount: withdrawal_amount, shares: shares_to_burn });

            self.reentrancy_guard.end();
            withdrawal_amount
        }

        fn borrow_asset(
            ref self: ContractState,
            collateral: ContractAddress,
            borrow_asset: ContractAddress,
            amount: u256
        ) -> u256 {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);
            assert(self.supported_assets.read(collateral), Errors::UNSUPPORTED_ASSET);
            assert(self.supported_assets.read(borrow_asset), Errors::UNSUPPORTED_ASSET);

            self.reentrancy_guard.start();

            let user = get_caller_address();

            // Check if user has sufficient collateral
            let lending_position = self.lending_positions.read((user, collateral));
            assert(lending_position.amount > 0, Errors::INSUFFICIENT_COLLATERAL);

            // Calculate required collateral (simplified - 150% collateralization ratio)
            let required_collateral = SafeMath::mul(amount, 150) / 100;
            assert(lending_position.amount >= required_collateral, Errors::INSUFFICIENT_COLLATERAL);

            // Check health factor
            let health_factor = self._calculate_health_factor(user, collateral, borrow_asset, amount);
            assert(health_factor >= 120, Errors::HEALTH_FACTOR_TOO_LOW); // 120% minimum

            // Update or create borrowing position
            let mut borrow_position = self.borrowing_positions.read((user, borrow_asset));
            borrow_position.user = user;
            borrow_position.collateral_asset = collateral;
            borrow_position.borrow_asset = borrow_asset;
            borrow_position.collateral_amount = required_collateral;
            borrow_position.borrowed_amount = SafeMath::add(borrow_position.borrowed_amount, amount);
            borrow_position.timestamp = starknet::get_block_timestamp();

            self.borrowing_positions.write((user, borrow_asset), borrow_position);

            // Transfer borrowed asset to user
            let token_contract = IERC20Dispatcher { contract_address: borrow_asset };
            let success = token_contract.transfer(user, amount);
            assert(success, 'Transfer failed');

            self.emit(AssetBorrowed {
                user,
                collateral_asset: collateral,
                borrow_asset,
                collateral_amount: required_collateral,
                borrowed_amount: amount,
            });

            self.reentrancy_guard.end();
            amount
        }

        fn repay_borrowed_asset(ref self: ContractState, asset: ContractAddress, amount: u256) -> u256 {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);

            self.reentrancy_guard.start();

            let user = get_caller_address();
            let mut position = self.borrowing_positions.read((user, asset));
            assert(position.borrowed_amount > 0, Errors::POSITION_NOT_FOUND);

            // Calculate repayment amount (including interest)
            let repayment_amount = self._calculate_repayment_amount(asset, amount);
            let actual_repay = if repayment_amount > position.borrowed_amount {
                position.borrowed_amount
            } else {
                repayment_amount
            };

            // Transfer tokens from user to contract
            let token_contract = IERC20Dispatcher { contract_address: asset };
            let success = token_contract.transfer_from(user, starknet::get_contract_address(), actual_repay);
            assert(success, 'Transfer failed');

            // Update position
            position.borrowed_amount = SafeMath::sub(position.borrowed_amount, actual_repay);
            self.borrowing_positions.write((user, asset), position);

            self.emit(AssetRepaid { user, asset, amount: actual_repay });

            self.reentrancy_guard.end();
            actual_repay
        }

        // View functions
        fn get_lending_apy(self: @ContractState, asset: ContractAddress) -> u256 {
            self.asset_lending_rates.read(asset)
        }

        fn get_borrowing_apy(self: @ContractState, asset: ContractAddress) -> u256 {
            self.asset_borrowing_rates.read(asset)
        }

        fn get_user_lending_balance(self: @ContractState, user: ContractAddress, asset: ContractAddress) -> u256 {
            let position = self.lending_positions.read((user, asset));
            position.amount
        }

        fn get_health_factor(self: @ContractState, user: ContractAddress) -> u256 {
            // Simplified health factor calculation
            // In real implementation, this would consider all positions and current prices
            120 // Default safe value
        }

        fn get_liquidation_threshold(self: @ContractState, user: ContractAddress) -> u256 {
            // Simplified liquidation threshold
            80 // 80% threshold
        }

        // Admin functions
        fn add_supported_asset(ref self: ContractState, asset: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(!asset.is_zero(), Errors::ZERO_ADDRESS);

            self.supported_assets.write(asset, true);
            self.emit(AssetAdded { asset });
        }

        fn update_rates(ref self: ContractState, asset: ContractAddress, lending_rate: u256, borrowing_rate: u256) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);

            self.asset_lending_rates.write(asset, lending_rate);
            self.asset_borrowing_rates.write(asset, borrowing_rate);

            self.emit(RatesUpdated { asset, lending_rate, borrowing_rate });
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

        fn _calculate_lending_shares(self: @ContractState, asset: ContractAddress, amount: u256) -> u256 {
            // Simplified share calculation - in real implementation, this would use Vesu's formula
            amount
        }

        fn _calculate_shares_to_burn(
            self: @ContractState, asset: ContractAddress, amount: u256, total_shares: u256, total_amount: u256
        ) -> u256 {
            if total_amount == 0 {
                return 0;
            }
            SafeMath::div(SafeMath::mul(amount, total_shares), total_amount)
        }

        fn _calculate_withdrawal_amount(self: @ContractState, asset: ContractAddress, amount: u256) -> u256 {
            // Simplified - in real implementation, this would include accrued interest
            amount
        }

        fn _calculate_repayment_amount(self: @ContractState, asset: ContractAddress, amount: u256) -> u256 {
            // Simplified - in real implementation, this would include accrued interest
            amount
        }

        fn _calculate_health_factor(
            self: @ContractState,
            user: ContractAddress,
            collateral: ContractAddress,
            borrow_asset: ContractAddress,
            borrow_amount: u256
        ) -> u256 {
            // Simplified health factor calculation
            // In real implementation, this would use oracle prices and proper formulas
            150 // Default safe value
        }
    }
}

#[starknet::interface]
trait IVesuAdapter<TContractState> {
    fn lend_asset(ref self: TContractState, asset: ContractAddress, amount: u256) -> u256;
    fn withdraw_lent_asset(ref self: TContractState, asset: ContractAddress, amount: u256) -> u256;
    fn borrow_asset(
        ref self: TContractState,
        collateral: ContractAddress,
        borrow_asset: ContractAddress,
        amount: u256
    ) -> u256;
    fn repay_borrowed_asset(ref self: TContractState, asset: ContractAddress, amount: u256) -> u256;
    fn get_lending_apy(self: @TContractState, asset: ContractAddress) -> u256;
    fn get_borrowing_apy(self: @TContractState, asset: ContractAddress) -> u256;
    fn get_user_lending_balance(self: @TContractState, user: ContractAddress, asset: ContractAddress) -> u256;
    fn get_health_factor(self: @TContractState, user: ContractAddress) -> u256;
    fn get_liquidation_threshold(self: @TContractState, user: ContractAddress) -> u256;
    fn add_supported_asset(ref self: TContractState, asset: ContractAddress);
    fn update_rates(ref self: TContractState, asset: ContractAddress, lending_rate: u256, borrowing_rate: u256);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
}