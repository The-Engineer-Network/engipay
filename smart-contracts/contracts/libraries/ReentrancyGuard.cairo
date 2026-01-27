use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

const NOT_ENTERED: u8 = 1;
const ENTERED: u8 = 2;

#[starknet::component]
mod ReentrancyGuardComponent {
    use super::{NOT_ENTERED, ENTERED};
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};

    #[storage]
    struct Storage {
        status: u8,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {}

    #[generate_trait]
    impl InternalImpl<
        TContractState, +HasComponent<TContractState>
    > of InternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>) {
            self.status.write(NOT_ENTERED);
        }

        fn start(ref self: ComponentState<TContractState>) {
            assert(self.status.read() != ENTERED, 'ReentrancyGuard: reentrant call');
            self.status.write(ENTERED);
        }

        fn end(ref self: ComponentState<TContractState>) {
            self.status.write(NOT_ENTERED);
        }
    }
}

#[starknet::interface]
trait IReentrancyGuard<TContractState> {
    fn is_entered(self: @TContractState) -> bool;
}

impl ReentrancyGuardImpl<
    TContractState, +HasComponent<TContractState>
> of IReentrancyGuard<TContractState> {
    fn is_entered(self: @TContractState) -> bool {
        let component = get_dep_component!(self, ReentrancyGuard);
        component.status.read() == ENTERED
    }
}