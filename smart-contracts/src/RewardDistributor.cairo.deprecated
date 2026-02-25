#[contract]
mod RewardDistributor {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use option::OptionTrait;
    use traits::Into;
    use traits::TryInto;

    // Events
    #[event]
    fn RewardPoolAdded(pool_id: u256, token: ContractAddress, reward_rate: u256) {}

    #[event]
    fn Staked(user: ContractAddress, pool_id: u256, amount: u256) {}

    #[event]
    fn Unstaked(user: ContractAddress, pool_id: u256, amount: u256) {}

    #[event]
    fn RewardsClaimed(user: ContractAddress, pool_id: u256, amount: u256) {}

    #[event]
    fn PoolUpdated(pool_id: u256, new_reward_rate: u256) {}

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
        reward_debt: u256, // Reward debt for precision
        last_stake_time: u64,
    }

    // Storage
    struct Storage {
        owner: ContractAddress,
        pool_count: u256,
        pools: LegacyMap<u256, RewardPool>,
        user_stakes: LegacyMap<(u256, ContractAddress), UserStake>, // (pool_id, user) -> stake info
        user_rewards: LegacyMap<(u256, ContractAddress), u256>, // (pool_id, user) -> pending rewards
    }

    // Constructor
    #[constructor]
    fn constructor(owner: ContractAddress) {
        self.owner.write(owner);
        self.pool_count.write(0);
    }

    // Create a new reward pool
    #[external]
    fn create_pool(token: ContractAddress, initial_reward_rate: u256) -> u256 {
        assert(get_caller_address() == self.owner.read(), 'Only owner can create pools');

        let pool_id = self.pool_count.read() + 1;
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

        RewardPoolAdded(pool_id, token, initial_reward_rate);
        pool_id
    }

    // Update reward rate for a pool
    #[external]
    fn update_pool_reward_rate(pool_id: u256, new_reward_rate: u256) {
        assert(get_caller_address() == self.owner.read(), 'Only owner can update pools');

        let mut pool = self.pools.read(pool_id);
        assert(pool.token != 0.try_into().unwrap(), 'Pool does not exist');

        // Update rewards before changing rate
        self._update_pool_rewards(pool_id);

        pool.reward_rate = new_reward_rate;
        pool.last_update_time = get_block_timestamp();

        self.pools.write(pool_id, pool);

        PoolUpdated(pool_id, new_reward_rate);
    }

    // Pause/unpause a pool
    #[external]
    fn toggle_pool_pause(pool_id: u256) {
        assert(get_caller_address() == self.owner.read(), 'Only owner can pause pools');

        let mut pool = self.pools.read(pool_id);
        assert(pool.token != 0.try_into().unwrap(), 'Pool does not exist');

        pool.paused = !pool.paused;
        self.pools.write(pool_id, pool);
    }

    // Stake tokens in a pool
    #[external]
    fn stake(pool_id: u256, amount: u256) {
        assert(amount > 0, 'Cannot stake 0 tokens');

        let user = get_caller_address();
        let mut pool = self.pools.read(pool_id);
        assert(pool.token != 0.try_into().unwrap(), 'Pool does not exist');
        assert(!pool.paused, 'Pool is paused');

        // Update rewards before staking
        self._update_user_rewards(pool_id, user);

        // Update user stake
        let mut user_stake = self.user_stakes.read((pool_id, user));
        user_stake.amount += amount;
        user_stake.last_stake_time = get_block_timestamp();

        // Update reward debt
        user_stake.reward_debt = (user_stake.amount * pool.reward_per_token_stored) / (10_u256.pow(18));

        self.user_stakes.write((pool_id, user), user_stake);

        // Update pool total
        pool.total_staked += amount;
        self.pools.write(pool_id, pool);

        // Transfer tokens from user to contract (would need ERC20 interface)
        // self._transfer_from(pool.token, user, starknet::get_contract_address(), amount);

        Staked(user, pool_id, amount);
    }

    // Unstake tokens from a pool
    #[external]
    fn unstake(pool_id: u256, amount: u256) {
        let user = get_caller_address();
        let mut user_stake = self.user_stakes.read((pool_id, user));
        assert(user_stake.amount >= amount, 'Insufficient staked balance');

        let mut pool = self.pools.read(pool_id);
        assert(pool.token != 0.try_into().unwrap(), 'Pool does not exist');

        // Update rewards before unstaking
        self._update_user_rewards(pool_id, user);

        // Update user stake
        user_stake.amount -= amount;
        self.user_stakes.write((pool_id, user), user_stake);

        // Update pool total
        pool.total_staked -= amount;
        self.pools.write(pool_id, pool);

        // Transfer tokens back to user (would need ERC20 interface)
        // self._transfer(pool.token, user, amount);

        Unstaked(user, pool_id, amount);
    }

    // Claim rewards from a pool
    #[external]
    fn claim_rewards(pool_id: u256) {
        let user = get_caller_address();
        let pool = self.pools.read(pool_id);
        assert(pool.token != 0.try_into().unwrap(), 'Pool does not exist');

        // Update rewards
        self._update_user_rewards(pool_id, user);

        let pending_rewards = self.user_rewards.read((pool_id, user));
        assert(pending_rewards > 0, 'No rewards to claim');

        // Reset user rewards
        self.user_rewards.write((pool_id, user), 0);

        // Transfer reward tokens to user (would need ERC20 interface)
        // self._transfer(pool.token, user, pending_rewards);

        RewardsClaimed(user, pool_id, pending_rewards);
    }

    // View functions
    #[view]
    fn get_pool_info(pool_id: u256) -> RewardPool {
        self.pools.read(pool_id)
    }

    #[view]
    fn get_user_stake(pool_id: u256, user: ContractAddress) -> UserStake {
        self.user_stakes.read((pool_id, user))
    }

    #[view]
    fn get_pending_rewards(pool_id: u256, user: ContractAddress) -> u256 {
        let pool = self.pools.read(pool_id);
        if (pool.token == 0.try_into().unwrap()) {
            return 0;
        }

        // Update rewards calculation
        self._update_user_rewards(pool_id, user);
        self.user_rewards.read((pool_id, user))
    }

    #[view]
    fn get_total_pools() -> u256 {
        self.pool_count.read()
    }

    // Internal functions
    fn _update_pool_rewards(pool_id: u256) {
        let mut pool = self.pools.read(pool_id);
        let current_time = get_block_timestamp();
        let time_elapsed = current_time - pool.last_update_time;

        if (time_elapsed > 0 && pool.total_staked > 0) {
            let reward_per_token = (time_elapsed.into() * pool.reward_rate) / pool.total_staked.into();
            pool.reward_per_token_stored += reward_per_token.into();
            pool.last_update_time = current_time;
            self.pools.write(pool_id, pool);
        }
    }

    fn _update_user_rewards(pool_id: u256, user: ContractAddress) {
        self._update_pool_rewards(pool_id);

        let pool = self.pools.read(pool_id);
        let user_stake = self.user_stakes.read((pool_id, user));

        if (user_stake.amount > 0) {
            let earned = (user_stake.amount * pool.reward_per_token_stored) / (10_u256.pow(18)) - user_stake.reward_debt;
            let current_rewards = self.user_rewards.read((pool_id, user));
            self.user_rewards.write((pool_id, user), current_rewards + earned);

            // Update reward debt
            let mut updated_stake = user_stake;
            updated_stake.reward_debt = (user_stake.amount * pool.reward_per_token_stored) / (10_u256.pow(18));
            self.user_stakes.write((pool_id, user), updated_stake);
        }
    }

    // Emergency functions
    #[external]
    fn emergency_withdraw(pool_id: u256) {
        let user = get_caller_address();
        let user_stake = self.user_stakes.read((pool_id, user));
        assert(user_stake.amount > 0, 'No stake to withdraw');

        let mut pool = self.pools.read(pool_id);

        // Reset user stake
        let mut empty_stake = UserStake {
            amount: 0,
            reward_debt: 0,
            last_stake_time: 0,
        };
        self.user_stakes.write((pool_id, user), empty_stake);

        // Update pool total
        pool.total_staked -= user_stake.amount;
        self.pools.write(pool_id, pool);

        // Transfer tokens back (emergency - no rewards)
        // self._transfer(pool.token, user, user_stake.amount);
    }

    // Admin function to fund rewards
    #[external]
    fn fund_rewards(pool_id: u256, amount: u256) {
        let pool = self.pools.read(pool_id);
        assert(pool.token != 0.try_into().unwrap(), 'Pool does not exist');

        // Transfer reward tokens to contract (would need ERC20 interface)
        // self._transfer_from(pool.token, get_caller_address(), starknet::get_contract_address(), amount);
    }
}