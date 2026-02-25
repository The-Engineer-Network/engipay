const NOT_ENTERED: u8 = 1;
const ENTERED: u8 = 2;

#[starknet::component]
pub mod ReentrancyGuardComponent {
    use super::{NOT_ENTERED, ENTERED};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    pub struct Storage {
        pub status: u8,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {}

    pub trait ReentrancyGuardInternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>);
        fn start(ref self: ComponentState<TContractState>);
        fn end(ref self: ComponentState<TContractState>);
    }

    pub impl ReentrancyGuardInternalImpl<
        TContractState, +HasComponent<TContractState>
    > of ReentrancyGuardInternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>) {
            self.status.write(NOT_ENTERED);
        }

        fn start(ref self: ComponentState<TContractState>) {
            assert(self.status.read() != ENTERED, 'reentrant call');
            self.status.write(ENTERED);
        }

        fn end(ref self: ComponentState<TContractState>) {
            self.status.write(NOT_ENTERED);
        }
    }
}
