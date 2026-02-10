#[starknet::contract]
mod RewardDistributorV2 {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess
    };
    use super::interfaces::IERC20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::libraries::SafeMath::{SafeMath, SafeMathTrait};
    use super::libraries::AccessControl::{
        AccessControlComponent, DEFAULT_ADMIN_ROLE, PAUSER_ROLE
    };
    use super::libraries::ReentrancyGuard::{ReentrancyGuardComponent};

    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl ReentrancyGuardImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    // Reward Pool Structure
    #[derive(Drop, Serde, starknet::Store)]
    struct RewardPool {
        token: ContractAddress,
        reward_rate: u256, // Rewards per second
        total_staked: u256,
        last_update_time: u64,
        reward_per_token_stored: u256,
        paused: bool,
    }

    // User Stake Info
    #[derive(Drop, Serde, starknet::Store)]
    struct UserStake {
        amount: u256,
        reward_debt: u256,
        last_stake_time: u64,
    }

    // Storage
    #[storage]
    struct Storage {
        pool_count: u256,
        pools: Map<u256, RewardPool>,
        user_stakes: Map<(u256, ContractAddress), UserStake>,
        user_rewards: Map<(u256, ContractAddress), u256>,
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
        RewardPoolAdded: RewardPoolAdded,
        Staked: Staked,
        Unstaked: Unstaked,
        RewardsClaimed: RewardsClaimed,
        PoolUpdated: PoolUpdated,
        PoolPaused: PoolPaused,
        PoolUnpaused: PoolUnpaused,
        AccessControlEvent: AccessControlComponent::Event,
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct RewardPoolAdded {
        #[key]
        pool_id: u256,
        #[key]
        token: ContractAddress,
        reward_rate: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Staked {
        #[key]
        user: ContractAddress,
        #[key]
        pool_id: u256,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Unstaked {
        #[key]
        user: ContractAddress,
        #[key]
        pool_id: u256,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct RewardsClaimed {
        #[key]
        user: ContractAddress,
        #[key]
        pool_id: u256,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PoolUpdated {
        #[key]
        pool_id: u256,
        new_reward_rate: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PoolPaused {
        #[key]
        pool_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PoolUnpaused {
        #[key]
        pool_id: u256,
    }

    mod Errors {
        const ZERO_AMOUNT: felt252 = 'Amount cannot be zero';
        const ZERO_ADDRESS: felt252 = 'Zero address not allowed';
        const POOL_NOT_FOUND: felt252 = 'Pool does not exist';
        const POOL_PAUSED: felt252 = 'Pool is paused';
        const INSUFFICIENT_STAKE: felt252 = 'Insufficient staked balance';
        const NO_REWARDS: felt252 = 'No rewards to claim';
        const CONTRACT_PAUSED: felt252 = 'Contract is paused';
        const TRANSFER_FAILED: felt252 = 'Token transfer failed';
    }

    // Constructor
    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        assert(!owner.is_zero(), Errors::ZERO_ADDRESS);

        self.pool_count.write(0);
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
    impl RewardDistributorImpl of IRewardDistributor<ContractState> {
        fn create_pool(ref self: ContractState, token: ContractAddress, initial_reward_rate: u256) -> u256 {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(!token.is_zero(), Errors::ZERO_ADDRESS);

            let pool_id = SafeMath::add(self.pool_count.read(), 1);
            self.pool_count.write(pool_id);

            let pool = RewardPool {
                token: token,
                reward_rate: initial_reward_rate,
                total_staked: 0,
                last_update_time: get_block_timestamp(),
                reward_per_token_stored: 0,
                paused: false,
            };

            self.pools.write(pool_id, pool);

            self.emit(RewardPoolAdded { pool_id, token, reward_rate: initial_reward_rate });
            pool_id
        }

        fn update_pool_reward_rate(ref self: ContractState, pool_id: u256, new_reward_rate: u256) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);

            let mut pool = self.pools.read(pool_id);
            assert(!pool.token.is_zero(), Errors::POOL_NOT_FOUND);

            // Update rewards before changing rate
            self._update_pool_rewards(pool_id);

            pool.reward_rate = new_reward_rate;
            pool.last_update_time = get_block_timestamp();

            self.pools.write(pool_id, pool);

            self.emit(PoolUpdated { pool_id, new_reward_rate });
        }

        fn toggle_pool_pause(ref self: ContractState, pool_id: u256) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);

            let mut pool = self.pools.read(pool_id);
            assert(!pool.token.is_zero(), Errors::POOL_NOT_FOUND);

            pool.paused = !pool.paused;
            self.pools.write(pool_id, pool);

            if pool.paused {
                self.emit(PoolPaused { pool_id });
            } else {
                self.emit(PoolUnpaused { pool_id });
            }
        }

        fn stake(ref self: ContractState, pool_id: u256, amount: u256) {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);

            let user = get_caller_address();
            let mut pool = self.pools.read(pool_id);
            assert(!pool.token.is_zero(), Errors::POOL_NOT_FOUND);
            assert(!pool.paused, Errors::POOL_PAUSED);

            self.reentrancy_guard.start();

            // Update rewards before staking
            self._update_user_rewards(pool_id, user);

            // Transfer tokens from user to contract
            let token_contract = IERC20Dispatcher { contract_address: pool.token };
            let success = token_contract.transfer_from(user, starknet::get_contract_address(), amount);
            assert(success, Errors::TRANSFER_FAILED);

            // Update user stake
            let mut user_stake = self.user_stakes.read((pool_id, user));
            user_stake.amount = SafeMath::add(user_stake.amount, amount);
            user_stake.last_stake_time = get_block_timestamp();
            user_stake.reward_debt = SafeMath::div(
                SafeMath::mul(user_stake.amount, pool.reward_per_token_stored),
                1000000000000000000
            );

            self.user_stakes.write((pool_id, user), user_stake);

            // Update pool total
            pool.total_staked = SafeMath::add(pool.total_staked, amount);
            self.pools.write(pool_id, pool);

            self.emit(Staked { user, pool_id, amount });

            self.reentrancy_guard.end();
        }

        fn unstake(ref self: ContractState, pool_id: u256, amount: u256) {
            self._assert_not_paused();
            let user = get_caller_address();
            let mut user_stake = self.user_stakes.read((pool_id, user));
            assert(user_stake.amount >= amount, Errors::INSUFFICIENT_STAKE);

            let mut pool = self.pools.read(pool_id);
            assert(!pool.token.is_zero(), Errors::POOL_NOT_FOUND);

            self.reentrancy_guard.start();

            // Update rewards before unstaking
            self._update_user_rewards(pool_id, user);

            // Update user stake
            user_stake.amount = SafeMath::sub(user_stake.amount, amount);
            self.user_stakes.write((pool_id, user), user_stake);

            // Update pool total
            pool.total_staked = SafeMath::sub(pool.total_staked, amount);
            self.pools.write(pool_id, pool);

            // Transfer tokens back to user
            let token_contract = IERC20Dispatcher { contract_address: pool.token };
            let success = token_contract.transfer(user, amount);
            assert(success, Errors::TRANSFER_FAILED);

            self.emit(Unstaked { user, pool_id, amount });

            self.reentrancy_guard.end();
        }

        fn claim_rewards(ref self: ContractState, pool_id: u256) {
            self._assert_not_paused();
            let user = get_caller_address();
            let pool = self.pools.read(pool_id);
            assert(!pool.token.is_zero(), Errors::POOL_NOT_FOUND);

            self.reentrancy_guard.start();

            // Update rewards
            self._update_user_rewards(pool_id, user);

            let pending_rewards = self.user_rewards.read((pool_id, user));
            assert(pending_rewards > 0, Errors::NO_REWARDS);

            // Reset user rewards
            self.user_rewards.write((pool_id, user), 0);

            // Transfer reward tokens to user
            let token_contract = IERC20Dispatcher { contract_address: pool.token };
            let success = token_contract.transfer(user, pending_rewards);
            assert(success, Errors::TRANSFER_FAILED);

            self.emit(RewardsClaimed { user, pool_id, amount: pending_rewards });

            self.reentrancy_guard.end();
        }

        fn emergency_withdraw(ref self: ContractState, pool_id: u256) {
            let user = get_caller_address();
            let user_stake = self.user_stakes.read((pool_id, user));
            assert(user_stake.amount > 0, 'No stake to withdraw');

            let mut pool = self.pools.read(pool_id);

            self.reentrancy_guard.start();

            // Reset user stake
            let empty_stake = UserStake {
                amount: 0,
                reward_debt: 0,
                last_stake_time: 0,
            };
            self.user_stakes.write((pool_id, user), empty_stake);

            // Update pool total
            pool.total_staked = SafeMath::sub(pool.total_staked, user_stake.amount);
            self.pools.write(pool_id, pool);

            // Transfer tokens back (emergency - no rewards)
            let token_contract = IERC20Dispatcher { contract_address: pool.token };
            let success = token_contract.transfer(user, user_stake.amount);
            assert(success, Errors::TRANSFER_FAILED);

            self.reentrancy_guard.end();
        }

        fn fund_rewards(ref self: ContractState, pool_id: u256, amount: u256) {
            let pool = self.pools.read(pool_id);
            assert(!pool.token.is_zero(), Errors::POOL_NOT_FOUND);
            assert(amount > 0, Errors::ZERO_AMOUNT);

            self.reentrancy_guard.start();

            // Transfer reward tokens to contract
            let token_contract = IERC20Dispatcher { contract_address: pool.token };
            let success = token_contract.transfer_from(
                get_caller_address(),
                starknet::get_contract_address(),
                amount
            );
            assert(success, Errors::TRANSFER_FAILED);

            self.reentrancy_guard.end();
        }

        // View functions
        fn get_pool_info(self: @ContractState, pool_id: u256) -> RewardPool {
            self.pools.read(pool_id)
        }

        fn get_user_stake(self: @ContractState, pool_id: u256, user: ContractAddress) -> UserStake {
            self.user_stakes.read((pool_id, user))
        }

        fn get_pending_rewards(self: @ContractState, pool_id: u256, user: ContractAddress) -> u256 {
            let pool = self.pools.read(pool_id);
            if pool.token.is_zero() {
                return 0;
            }

            let user_stake = self.user_stakes.read((pool_id, user));
            if user_stake.amount == 0 {
                return self.user_rewards.read((pool_id, user));
            }

            // Calculate pending rewards
            let current_time = get_block_timestamp();
            let time_elapsed = current_time - pool.last_update_time;

            let mut reward_per_token = pool.reward_per_token_stored;
            if time_elapsed > 0 && pool.total_staked > 0 {
                let reward = SafeMath::div(
                    SafeMath::mul(time_elapsed.into(), pool.reward_rate),
                    pool.total_staked
                );
                reward_per_token = SafeMath::add(reward_per_token, reward);
            }

            let earned = SafeMath::sub(
                SafeMath::div(SafeMath::mul(user_stake.amount, reward_per_token), 1000000000000000000),
                user_stake.reward_debt
            );
            SafeMath::add(self.user_rewards.read((pool_id, user)), earned)
        }

        fn get_total_pools(self: @ContractState) -> u256 {
            self.pool_count.read()
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

        fn _update_pool_rewards(ref self: ContractState, pool_id: u256) {
            let mut pool = self.pools.read(pool_id);
            let current_time = get_block_timestamp();
            let time_elapsed = current_time - pool.last_update_time;

            if time_elapsed > 0 && pool.total_staked > 0 {
                let reward_per_token = SafeMath::div(
                    SafeMath::mul(time_elapsed.into(), pool.reward_rate),
                    pool.total_staked
                );
                pool.reward_per_token_stored = SafeMath::add(pool.reward_per_token_stored, reward_per_token);
                pool.last_update_time = current_time;
                self.pools.write(pool_id, pool);
            }
        }

        fn _update_user_rewards(ref self: ContractState, pool_id: u256, user: ContractAddress) {
            self._update_pool_rewards(pool_id);

            let pool = self.pools.read(pool_id);
            let user_stake = self.user_stakes.read((pool_id, user));

            if user_stake.amount > 0 {
                let earned = SafeMath::sub(
                    SafeMath::div(SafeMath::mul(user_stake.amount, pool.reward_per_token_stored), 1000000000000000000),
                    user_stake.reward_debt
                );
                let current_rewards = self.user_rewards.read((pool_id, user));
                self.user_rewards.write((pool_id, user), SafeMath::add(current_rewards, earned));

                // Update reward debt
                let mut updated_stake = user_stake;
                updated_stake.reward_debt = SafeMath::div(
                    SafeMath::mul(user_stake.amount, pool.reward_per_token_stored),
                    1000000000000000000
                );
                self.user_stakes.write((pool_id, user), updated_stake);
            }
        }
    }
}

#[starknet::interface]
trait IRewardDistributor<TContractState> {
    fn create_pool(ref self: TContractState, token: ContractAddress, initial_reward_rate: u256) -> u256;
    fn update_pool_reward_rate(ref self: TContractState, pool_id: u256, new_reward_rate: u256);
    fn toggle_pool_pause(ref self: TContractState, pool_id: u256);
    fn stake(ref self: TContractState, pool_id: u256, amount: u256);
    fn unstake(ref self: TContractState, pool_id: u256, amount: u256);
    fn claim_rewards(ref self: TContractState, pool_id: u256);
    fn emergency_withdraw(ref self: TContractState, pool_id: u256);
    fn fund_rewards(ref self: TContractState, pool_id: u256, amount: u256);
    fn get_pool_info(self: @TContractState, pool_id: u256) -> RewardDistributorV2::RewardPool;
    fn get_user_stake(self: @TContractState, pool_id: u256, user: ContractAddress) -> RewardDistributorV2::UserStake;
    fn get_pending_rewards(self: @TContractState, pool_id: u256, user: ContractAddress) -> u256;
    fn get_total_pools(self: @TContractState) -> u256;
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
}
