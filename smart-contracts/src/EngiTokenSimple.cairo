#[starknet::contract]
pub mod EngiTokenSimple {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
        StoragePointerReadAccess, StoragePointerWriteAccess
    };

    #[storage]
    struct Storage {
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        owner: ContractAddress,
        minters: Map<ContractAddress, bool>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Transfer {
        #[key]
        pub from: ContractAddress,
        #[key]
        pub to: ContractAddress,
        pub value: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Approval {
        #[key]
        pub owner: ContractAddress,
        #[key]
        pub spender: ContractAddress,
        pub value: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, initial_supply: u256, owner: ContractAddress) {
        self.total_supply.write(initial_supply);
        self.balances.write(owner, initial_supply);
        self.owner.write(owner);
        self.minters.write(owner, true);
        
        self.emit(Transfer { 
            from: Zero::zero(), 
            to: owner, 
            value: initial_supply 
        });
    }

    #[starknet::interface]
    trait IERC20<TContractState> {
        fn total_supply(self: @TContractState) -> u256;
        fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
        fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
        fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
        fn transfer_from(ref self: TContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool;
        fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
        fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
    }

    #[abi(embed_v0)]
    impl ERC20Impl of IERC20<ContractState> {
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
            assert(!Zero::is_zero(@recipient), 'zero address');
            
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'insufficient balance');
            
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn transfer_from(ref self: ContractState, sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool {
            let caller = get_caller_address();
            assert(!Zero::is_zero(@recipient), 'zero address');
            
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'insufficient balance');
            
            let current_allowance = self.allowances.read((sender, caller));
            assert(current_allowance >= amount, 'insufficient allowance');
            
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.allowances.write((sender, caller), current_allowance - amount);
            
            self.emit(Transfer { from: sender, to: recipient, value: amount });
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            assert(!Zero::is_zero(@spender), 'zero address');
            
            self.allowances.write((owner, spender), amount);
            self.emit(Approval { owner, spender, value: amount });
            true
        }

        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            let caller = get_caller_address();
            assert(self.minters.read(caller), 'not minter');
            assert(!Zero::is_zero(@to), 'zero address');
            
            self.total_supply.write(self.total_supply.read() + amount);
            self.balances.write(to, self.balances.read(to) + amount);
            
            self.emit(Transfer { from: Zero::zero(), to, value: amount });
        }
    }
}
