#[starknet::contract]
pub mod EscrowTiny {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess, StoragePointerWriteAccess};
    use engipay_contracts::interfaces::IERC20::{IERC20Dispatcher, IERC20DispatcherTrait};

    #[derive(Drop, Serde, starknet::Store, Copy)]
    pub struct Payment {
        pub sender: ContractAddress,
        pub recipient: ContractAddress,
        pub amount: u256,
        pub token: ContractAddress,
        pub fee: u256,
        pub active: bool,
    }

    #[storage]
    struct Storage {
        payments: Map<u256, Payment>,
        counter: u256,
        owner: ContractAddress,
        fee_rate: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Created: Created,
        Accepted: Accepted,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Created {
        pub id: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Accepted {
        pub id: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, fee_rate: u256) {
        self.owner.write(owner);
        self.fee_rate.write(fee_rate);
        self.counter.write(0);
    }

    #[starknet::interface]
    trait IEscrow<T> {
        fn create(ref self: T, recipient: ContractAddress, amount: u256, token: ContractAddress) -> u256;
        fn accept(ref self: T, id: u256);
        fn cancel(ref self: T, id: u256);
    }

    #[abi(embed_v0)]
    impl EscrowImpl of IEscrow<ContractState> {
        fn create(ref self: ContractState, recipient: ContractAddress, amount: u256, token: ContractAddress) -> u256 {
            let id = self.counter.read() + 1;
            self.counter.write(id);
            
            let fee = (amount * self.fee_rate.read()) / 10000;
            let total = amount + fee;
            
            IERC20Dispatcher { contract_address: token }.transfer_from(get_caller_address(), starknet::get_contract_address(), total);
            
            self.payments.write(id, Payment {
                sender: get_caller_address(),
                recipient,
                amount,
                token,
                fee,
                active: true,
            });
            
            self.emit(Created { id });
            id
        }

        fn accept(ref self: ContractState, id: u256) {
            let p = self.payments.read(id);
            assert(p.active && p.recipient == get_caller_address(), 'err');
            
            let mut updated = p;
            updated.active = false;
            self.payments.write(id, updated);
            
            let token = IERC20Dispatcher { contract_address: p.token };
            token.transfer(p.recipient, p.amount);
            token.transfer(self.owner.read(), p.fee);
            
            self.emit(Accepted { id });
        }

        fn cancel(ref self: ContractState, id: u256) {
            let p = self.payments.read(id);
            assert(p.active && p.sender == get_caller_address(), 'err');
            
            let mut updated = p;
            updated.active = false;
            self.payments.write(id, updated);
            
            IERC20Dispatcher { contract_address: p.token }.transfer(p.sender, p.amount + p.fee);
        }
    }
}
