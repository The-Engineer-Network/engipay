#[starknet::component]
pub mod AccessControlComponent {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, 
        StoragePointerReadAccess, StoragePointerWriteAccess
    };

    #[storage]
    pub struct Storage {
        pub roles: Map<(felt252, ContractAddress), bool>,
        pub role_admin: Map<felt252, felt252>,
        pub owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        RoleGranted: RoleGranted,
        RoleRevoked: RoleRevoked,
        OwnershipTransferred: OwnershipTransferred,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RoleGranted {
        pub role: felt252,
        pub account: ContractAddress,
        pub sender: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RoleRevoked {
        pub role: felt252,
        pub account: ContractAddress,
        pub sender: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct OwnershipTransferred {
        pub previous_owner: ContractAddress,
        pub new_owner: ContractAddress,
    }

    pub trait AccessControlInternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>, owner: ContractAddress);
        fn assert_only_owner(self: @ComponentState<TContractState>);
        fn assert_only_role(self: @ComponentState<TContractState>, role: felt252);
        fn has_role(
            self: @ComponentState<TContractState>, role: felt252, account: ContractAddress
        ) -> bool;
        fn grant_role(
            ref self: ComponentState<TContractState>, role: felt252, account: ContractAddress
        );
        fn revoke_role(
            ref self: ComponentState<TContractState>, role: felt252, account: ContractAddress
        );
        fn transfer_ownership(
            ref self: ComponentState<TContractState>, new_owner: ContractAddress
        );
        fn get_owner(self: @ComponentState<TContractState>) -> ContractAddress;
    }

    pub impl AccessControlInternalImpl<
        TContractState, +HasComponent<TContractState>
    > of AccessControlInternalTrait<TContractState> {
        fn initializer(ref self: ComponentState<TContractState>, owner: ContractAddress) {
            assert(!Zero::is_zero(@owner), 'zero address owner');
            self.owner.write(owner);
        }

        fn assert_only_owner(self: @ComponentState<TContractState>) {
            let caller = get_caller_address();
            assert(caller == self.owner.read(), 'unauthorized');
        }

        fn assert_only_role(self: @ComponentState<TContractState>, role: felt252) {
            let caller = get_caller_address();
            assert(self.has_role(role, caller), 'unauthorized');
        }

        fn has_role(
            self: @ComponentState<TContractState>, 
            role: felt252, 
            account: ContractAddress
        ) -> bool {
            self.roles.read((role, account))
        }

        fn grant_role(
            ref self: ComponentState<TContractState>, 
            role: felt252, 
            account: ContractAddress
        ) {
            assert(!Zero::is_zero(@account), 'invalid account');
            if !self.has_role(role, account) {
                self.roles.write((role, account), true);
                self.emit(RoleGranted { role, account, sender: get_caller_address() });
            }
        }

        fn revoke_role(
            ref self: ComponentState<TContractState>, 
            role: felt252, 
            account: ContractAddress
        ) {
            if self.has_role(role, account) {
                self.roles.write((role, account), false);
                self.emit(RoleRevoked { role, account, sender: get_caller_address() });
            }
        }

        fn transfer_ownership(
            ref self: ComponentState<TContractState>, 
            new_owner: ContractAddress
        ) {
            assert(!Zero::is_zero(@new_owner), 'zero address owner');
            let previous_owner = self.owner.read();
            self.owner.write(new_owner);
            self.emit(OwnershipTransferred { previous_owner, new_owner });
        }

        fn get_owner(self: @ComponentState<TContractState>) -> ContractAddress {
            self.owner.read()
        }
    }
}

// Role constants
pub const DEFAULT_ADMIN_ROLE: felt252 = 0;
pub const MINTER_ROLE: felt252 = selector!("MINTER_ROLE");
pub const PAUSER_ROLE: felt252 = selector!("PAUSER_ROLE");
pub const BRIDGE_ADMIN_ROLE: felt252 = selector!("BRIDGE_ADMIN_ROLE");
