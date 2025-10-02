#[contract]
mod EngiToken {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use array::ArrayTrait;
    use option::OptionTrait;
    use traits::Into;
    use traits::TryInto;

    // ERC20 Standard Events
    #[event]
    fn Transfer(from: ContractAddress, to: ContractAddress, value: u256) {}

    #[event]
    fn Approval(owner: ContractAddress, spender: ContractAddress, value: u256) {}

    // Governance Events
    #[event]
    fn Staked(account: ContractAddress, amount: u256) {}

    #[event]
    fn Unstaked(account: ContractAddress, amount: u256) {}

    #[event]
    fn RewardsClaimed(account: ContractAddress, amount: u256) {}

    #[event]
    fn ProposalCreated(proposal_id: u256, proposer: ContractAddress, description: felt252) {}

    #[event]
    fn Voted(proposal_id: u256, voter: ContractAddress, option: u8, votes: u256) {}

    // ERC20 Storage
    struct Storage {
        name: felt252,
        symbol: felt252,
        decimals: u8,
        total_supply: u256,
        balances: LegacyMap<ContractAddress, u256>,
        allowances: LegacyMap<(ContractAddress, ContractAddress), u256>,

        // Governance Storage
        owner: ContractAddress,
        staking_total: u256,
        staking_balances: LegacyMap<ContractAddress, u256>,
        staking_timestamps: LegacyMap<ContractAddress, u64>,
        reward_rate: u256, // Rewards per second per staked token
        last_update_time: u64,
        reward_per_token_stored: u256,
        user_reward_per_token_paid: LegacyMap<ContractAddress, u256>,
        rewards: LegacyMap<ContractAddress, u256>,

        // Proposal Storage
        proposal_count: u256,
        proposals: LegacyMap<u256, Proposal>,
        votes: LegacyMap<(u256, ContractAddress), u8>, // proposal_id -> voter -> option
    }

    // Proposal Structure
    #[derive(Drop, Serde, starknet::Store)]
    struct Proposal {
        id: u256,
        proposer: ContractAddress,
        description: felt252,
        start_time: u64,
        end_time: u64,
        executed: bool,
        votes_for: u256,
        votes_against: u256,
        votes_abstain: u256,
    }

    // Constructor
    #[constructor]
    fn constructor(
        name: felt252,
        symbol: felt252,
        initial_supply: u256,
        owner: ContractAddress
    ) {
        self.name.write(name);
        self.symbol.write(symbol);
        self.decimals.write(18);
        self.total_supply.write(initial_supply);
        self.balances.write(owner, initial_supply);
        self.owner.write(owner);
        self.last_update_time.write(starknet::get_block_timestamp());

        Transfer(0.try_into().unwrap(), owner, initial_supply);
    }

    // ERC20 Functions
    #[view]
    fn get_name() -> felt252 {
        self.name.read()
    }

    #[view]
    fn get_symbol() -> felt252 {
        self.symbol.read()
    }

    #[view]
    fn get_decimals() -> u8 {
        self.decimals.read()
    }

    #[view]
    fn get_total_supply() -> u256 {
        self.total_supply.read()
    }

    #[view]
    fn balance_of(account: ContractAddress) -> u256 {
        self.balances.read(account)
    }

    #[view]
    fn allowance(owner: ContractAddress, spender: ContractAddress) -> u256 {
        self.allowances.read((owner, spender))
    }

    #[external]
    fn transfer(recipient: ContractAddress, amount: u256) -> bool {
        let sender = get_caller_address();
        self._transfer(sender, recipient, amount);
        true
    }

    #[external]
    fn approve(spender: ContractAddress, amount: u256) -> bool {
        let owner = get_caller_address();
        self.allowances.write((owner, spender), amount);
        Approval(owner, spender, amount);
        true
    }

    #[external]
    fn transfer_from(sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool {
        let caller = get_caller_address();
        let current_allowance = self.allowances.read((sender, caller));
        assert(current_allowance >= amount, 'Insufficient allowance');

        self.allowances.write((sender, caller), current_allowance - amount);
        self._transfer(sender, recipient, amount);
        true
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