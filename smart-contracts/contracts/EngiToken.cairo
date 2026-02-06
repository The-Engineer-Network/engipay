#[starknet::contract]
mod EngiToken {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess
    };
    use super::interfaces::IERC20::{IERC20, IERC20Metadata, IERC20Camel};
    use super::libraries::SafeMath::{SafeMath, SafeMathTrait};
    use super::libraries::AccessControl::{
        AccessControlComponent, DEFAULT_ADMIN_ROLE, MINTER_ROLE, PAUSER_ROLE
    };
    use super::libraries::ReentrancyGuard::{ReentrancyGuardComponent};

    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl ReentrancyGuardImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    // ERC20 Events
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Transfer: Transfer,
        Approval: Approval,
        Staked: Staked,
        Unstaked: Unstaked,
        RewardsClaimed: RewardsClaimed,
        ProposalCreated: ProposalCreated,
        Voted: Voted,
        AccessControlEvent: AccessControlComponent::Event,
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct Transfer {
        #[key]
        from: ContractAddress,
        #[key]
        to: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Approval {
        #[key]
        owner: ContractAddress,
        #[key]
        spender: ContractAddress,
        value: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Staked {
        #[key]
        account: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct Unstaked {
        #[key]
        account: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct RewardsClaimed {
        #[key]
        account: ContractAddress,
        amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct ProposalCreated {
        #[key]
        proposal_id: u256,
        #[key]
        proposer: ContractAddress,
        description: ByteArray,
    }

    #[derive(Drop, starknet::Event)]
    struct Voted {
        #[key]
        proposal_id: u256,
        #[key]
        voter: ContractAddress,
        option: u8,
        votes: u256,
    }

    // Proposal Structure
    #[derive(Drop, Serde, starknet::Store)]
    struct Proposal {
        id: u256,
        proposer: ContractAddress,
        description: ByteArray,
        start_time: u64,
        end_time: u64,
        executed: bool,
        votes_for: u256,
        votes_against: u256,
        votes_abstain: u256,
    }

    // Storage
    #[storage]
    struct Storage {
        // ERC20 Storage
        name: ByteArray,
        symbol: ByteArray,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,

        // Governance Storage
        staking_total: u256,
        staking_balances: Map<ContractAddress, u256>,
        staking_timestamps: Map<ContractAddress, u64>,
        reward_rate: u256, // Rewards per second per staked token
        last_update_time: u64,
        reward_per_token_stored: u256,
        user_reward_per_token_paid: Map<ContractAddress, u256>,
        rewards: Map<ContractAddress, u256>,

        // Proposal Storage
        proposal_count: u256,
        proposals: Map<u256, Proposal>,
        votes: Map<(u256, ContractAddress), u8>, // proposal_id -> voter -> option

        // Pausable
        paused: bool,

        // Components
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    // Constructor
    #[constructor]
    fn constructor(
        ref self: ContractState,
        name: ByteArray,
        symbol: ByteArray,
        initial_supply: u256,
        owner: ContractAddress
    ) {
        self.name.write(name);
        self.symbol.write(symbol);
        self.decimals.write(18);
        self.total_supply.write(initial_supply);
        self.balances.write(owner, initial_supply);
        self.last_update_time.write(get_block_timestamp());
        self.paused.write(false);

        // Initialize components
        self.access_control.initializer(owner);
        self.reentrancy_guard.initializer();

        // Grant roles to owner
        self.access_control.grant_role(DEFAULT_ADMIN_ROLE, owner);
        self.access_control.grant_role(MINTER_ROLE, owner);
        self.access_control.grant_role(PAUSER_ROLE, owner);

        self.emit(Transfer { from: Zeroable::zero(), to: owner, value: initial_supply });
    }

    // ERC20 Implementation
    #[abi(embed_v0)]
    impl ERC20Impl of IERC20<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }

        fn allowance(self: @ContractState, owner: ContractAddress, spender: ContractAddress) -> u256 {
            self.allowances.read((owner, spender))
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self._approve(owner, spender, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'ERC20: insufficient allowance');

            self._approve(sender, caller, SafeMath::sub(current_allowance, amount));
            self._transfer(sender, recipient, amount);
            true
        }
    }

    // ERC20 Camel Case Implementation
    #[abi(embed_v0)]
    impl ERC20CamelImpl of IERC20Camel<ContractState> {
        fn totalSupply(self: @ContractState) -> u256 {
            self.total_supply()
        }

        fn balanceOf(self: @ContractState, account: ContractAddress) -> u256 {
            self.balance_of(account)
        }

        fn transferFrom(
            ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256
        ) -> bool {
            self.transfer_from(sender, recipient, amount)
        }
    }

    // Internal transfer function
    fn _transfer(sender: ContractAddress, recipient: ContractAddress, amount: u256) {
        let sender_balance = self.balances.read(sender);
        assert(sender_balance >= amount, 'Insufficient balance');

        self.balances.write(sender, sender_balance - amount);
        let recipient_balance = self.balances.read(recipient);
        self.balances.write(recipient, recipient_balance + amount);

        Transfer(sender, recipient, amount);
    }

    // Staking Functions
    #[external]
    fn stake(amount: u256) {
        let account = get_caller_address();
        assert(amount > 0, 'Cannot stake 0 tokens');

        let balance = self.balances.read(account);
        assert(balance >= amount, 'Insufficient balance');

        // Update rewards before staking
        self._update_reward(account);

        // Transfer tokens to contract
        self._transfer(account, starknet::get_contract_address(), amount);

        // Update staking balance
        let current_stake = self.staking_balances.read(account);
        self.staking_balances.write(account, current_stake + amount);
        self.staking_total.write(self.staking_total.read() + amount);

        if (current_stake == 0) {
            self.staking_timestamps.write(account, starknet::get_block_timestamp());
        }

        Staked(account, amount);
    }

    #[external]
    fn unstake(amount: u256) {
        let account = get_caller_address();
        let staked_balance = self.staking_balances.read(account);
        assert(staked_balance >= amount, 'Insufficient staked balance');

        // Update rewards before unstaking
        self._update_reward(account);

        // Update staking balance
        self.staking_balances.write(account, staked_balance - amount);
        self.staking_total.write(self.staking_total.read() - amount);

        // Transfer tokens back to user
        self._transfer(starknet::get_contract_address(), account, amount);

        Unstaked(account, amount);
    }

    #[external]
    fn claim_rewards() {
        let account = get_caller_address();
        self._update_reward(account);

        let reward = self.rewards.read(account);
        assert(reward > 0, 'No rewards to claim');

        self.rewards.write(account, 0);

        // Mint reward tokens (simplified - would need proper minting mechanism)
        let current_supply = self.total_supply.read();
        self.total_supply.write(current_supply + reward);
        self.balances.write(account, self.balances.read(account) + reward);

        RewardsClaimed(account, reward);
    }

    // Governance Functions
    #[external]
    fn create_proposal(description: felt252, duration_days: u64) -> u256 {
        let proposer = get_caller_address();
        let staked_balance = self.staking_balances.read(proposer);
        assert(staked_balance > 0, 'Must have staked tokens to propose');

        let proposal_id = self.proposal_count.read() + 1;
        self.proposal_count.write(proposal_id);

        let current_time = starknet::get_block_timestamp();
        let proposal = Proposal {
            id: proposal_id,
            proposer: proposer,
            description: description,
            start_time: current_time,
            end_time: current_time + (duration_days * 86400), // Convert days to seconds
            executed: false,
            votes_for: 0,
            votes_against: 0,
            votes_abstain: 0,
        };

        self.proposals.write(proposal_id, proposal);

        ProposalCreated(proposal_id, proposer, description);
        proposal_id
    }

    #[external]
    fn vote(proposal_id: u256, option: u8) {
        assert(option <= 2, 'Invalid vote option'); // 0=against, 1=for, 2=abstain

        let voter = get_caller_address();
        let voting_power = self.staking_balances.read(voter);
        assert(voting_power > 0, 'Must have staked tokens to vote');

        let mut proposal = self.proposals.read(proposal_id);
        assert(proposal.id != 0, 'Proposal does not exist');
        assert(starknet::get_block_timestamp() >= proposal.start_time, 'Voting has not started');
        assert(starknet::get_block_timestamp() <= proposal.end_time, 'Voting has ended');

        // Check if already voted
        let existing_vote = self.votes.read((proposal_id, voter));
        assert(existing_vote == 0, 'Already voted');

        // Record vote
        self.votes.write((proposal_id, voter), option);

        // Update vote counts
        if (option == 0) {
            proposal.votes_against += voting_power;
        } else if (option == 1) {
            proposal.votes_for += voting_power;
        } else {
            proposal.votes_abstain += voting_power;
        }

        self.proposals.write(proposal_id, proposal);

        Voted(proposal_id, voter, option, voting_power);
    }

    // View Functions
    #[view]
    fn get_staked_balance(account: ContractAddress) -> u256 {
        self.staking_balances.read(account)
    }

    #[view]
    fn get_pending_rewards(account: ContractAddress) -> u256 {
        self._update_reward(account);
        self.rewards.read(account)
    }

    #[view]
    fn get_proposal(proposal_id: u256) -> Proposal {
        self.proposals.read(proposal_id)
    }

    #[view]
    fn get_vote(proposal_id: u256, voter: ContractAddress) -> u8 {
        self.votes.read((proposal_id, voter))
    }

    // Internal reward calculation
    fn _update_reward(account: ContractAddress) {
        let current_time = starknet::get_block_timestamp();
        let time_elapsed = current_time - self.last_update_time.read();

        if (time_elapsed > 0 && self.staking_total.read() > 0) {
            let reward = (time_elapsed.into() * self.reward_rate.read()) / self.staking_total.read().into();
            self.reward_per_token_stored.write(self.reward_per_token_stored.read() + reward.into());
            self.last_update_time.write(current_time);
        }

        let user_stake = self.staking_balances.read(account);
        if (user_stake > 0) {
            let earned = (user_stake * (self.reward_per_token_stored.read() - self.user_reward_per_token_paid.read(account))) / (10_u256.pow(18)); // Adjust for decimals
            self.rewards.write(account, self.rewards.read(account) + earned);
        }

        self.user_reward_per_token_paid.write(account, self.reward_per_token_stored.read());
    }

    // Admin Functions
    #[external]
    fn set_reward_rate(new_rate: u256) {
        assert(get_caller_address() == self.owner.read(), 'Only owner can set reward rate');
        self.reward_rate.write(new_rate);
    }

    #[external]
    fn mint_tokens(recipient: ContractAddress, amount: u256) {
        assert(get_caller_address() == self.owner.read(), 'Only owner can mint tokens');

        let current_supply = self.total_supply.read();
        self.total_supply.write(current_supply + amount);
        let recipient_balance = self.balances.read(recipient);
        self.balances.write(recipient, recipient_balance + amount);

        Transfer(0.try_into().unwrap(), recipient, amount);
    }
}