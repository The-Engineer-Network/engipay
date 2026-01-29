export declare const ERC20Abi: readonly [{
    readonly type: "impl";
    readonly name: "MintableToken";
    readonly interface_name: "src::mintable_token_interface::IMintableToken";
}, {
    readonly type: "struct";
    readonly name: "core::integer::u256";
    readonly members: readonly [{
        readonly name: "low";
        readonly type: "core::integer::u128";
    }, {
        readonly name: "high";
        readonly type: "core::integer::u128";
    }];
}, {
    readonly type: "interface";
    readonly name: "src::mintable_token_interface::IMintableToken";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "permissioned_mint";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "permissioned_burn";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "MintableTokenCamelImpl";
    readonly interface_name: "src::mintable_token_interface::IMintableTokenCamel";
}, {
    readonly type: "interface";
    readonly name: "src::mintable_token_interface::IMintableTokenCamel";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "permissionedMint";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "permissionedBurn";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "Replaceable";
    readonly interface_name: "src::replaceability_interface::IReplaceable";
}, {
    readonly type: "struct";
    readonly name: "core::array::Span::<core::felt252>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<core::felt252>";
    }];
}, {
    readonly type: "struct";
    readonly name: "src::replaceability_interface::EICData";
    readonly members: readonly [{
        readonly name: "eic_hash";
        readonly type: "core::starknet::class_hash::ClassHash";
    }, {
        readonly name: "eic_init_data";
        readonly type: "core::array::Span::<core::felt252>";
    }];
}, {
    readonly type: "enum";
    readonly name: "core::option::Option::<src::replaceability_interface::EICData>";
    readonly variants: readonly [{
        readonly name: "Some";
        readonly type: "src::replaceability_interface::EICData";
    }, {
        readonly name: "None";
        readonly type: "()";
    }];
}, {
    readonly type: "enum";
    readonly name: "core::bool";
    readonly variants: readonly [{
        readonly name: "False";
        readonly type: "()";
    }, {
        readonly name: "True";
        readonly type: "()";
    }];
}, {
    readonly type: "struct";
    readonly name: "src::replaceability_interface::ImplementationData";
    readonly members: readonly [{
        readonly name: "impl_hash";
        readonly type: "core::starknet::class_hash::ClassHash";
    }, {
        readonly name: "eic_data";
        readonly type: "core::option::Option::<src::replaceability_interface::EICData>";
    }, {
        readonly name: "final";
        readonly type: "core::bool";
    }];
}, {
    readonly type: "interface";
    readonly name: "src::replaceability_interface::IReplaceable";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "get_upgrade_delay";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::integer::u64";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_impl_activation_time";
        readonly inputs: readonly [{
            readonly name: "implementation_data";
            readonly type: "src::replaceability_interface::ImplementationData";
        }];
        readonly outputs: readonly [{
            readonly type: "core::integer::u64";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "add_new_implementation";
        readonly inputs: readonly [{
            readonly name: "implementation_data";
            readonly type: "src::replaceability_interface::ImplementationData";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "remove_implementation";
        readonly inputs: readonly [{
            readonly name: "implementation_data";
            readonly type: "src::replaceability_interface::ImplementationData";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "replace_to";
        readonly inputs: readonly [{
            readonly name: "implementation_data";
            readonly type: "src::replaceability_interface::ImplementationData";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "AccessControlImplExternal";
    readonly interface_name: "src::access_control_interface::IAccessControl";
}, {
    readonly type: "interface";
    readonly name: "src::access_control_interface::IAccessControl";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "has_role";
        readonly inputs: readonly [{
            readonly name: "role";
            readonly type: "core::felt252";
        }, {
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_role_admin";
        readonly inputs: readonly [{
            readonly name: "role";
            readonly type: "core::felt252";
        }];
        readonly outputs: readonly [{
            readonly type: "core::felt252";
        }];
        readonly state_mutability: "view";
    }];
}, {
    readonly type: "impl";
    readonly name: "RolesImpl";
    readonly interface_name: "src::roles_interface::IMinimalRoles";
}, {
    readonly type: "interface";
    readonly name: "src::roles_interface::IMinimalRoles";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "is_governance_admin";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "is_upgrade_governor";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "register_governance_admin";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "remove_governance_admin";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "register_upgrade_governor";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "remove_upgrade_governor";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "renounce";
        readonly inputs: readonly [{
            readonly name: "role";
            readonly type: "core::felt252";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "ERC20Impl";
    readonly interface_name: "openzeppelin::token::erc20::interface::IERC20";
}, {
    readonly type: "interface";
    readonly name: "openzeppelin::token::erc20::interface::IERC20";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "name";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::felt252";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "symbol";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::felt252";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "decimals";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::integer::u8";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "total_supply";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::integer::u256";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "balance_of";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [{
            readonly type: "core::integer::u256";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "allowance";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "spender";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [{
            readonly type: "core::integer::u256";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "transfer";
        readonly inputs: readonly [{
            readonly name: "recipient";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "transfer_from";
        readonly inputs: readonly [{
            readonly name: "sender";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "recipient";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "approve";
        readonly inputs: readonly [{
            readonly name: "spender";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "ERC20CamelOnlyImpl";
    readonly interface_name: "openzeppelin::token::erc20::interface::IERC20CamelOnly";
}, {
    readonly type: "interface";
    readonly name: "openzeppelin::token::erc20::interface::IERC20CamelOnly";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "totalSupply";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::integer::u256";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "balanceOf";
        readonly inputs: readonly [{
            readonly name: "account";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [{
            readonly type: "core::integer::u256";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "transferFrom";
        readonly inputs: readonly [{
            readonly name: "sender";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "recipient";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [{
            readonly type: "core::bool";
        }];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "constructor";
    readonly name: "constructor";
    readonly inputs: readonly [{
        readonly name: "name";
        readonly type: "core::felt252";
    }, {
        readonly name: "symbol";
        readonly type: "core::felt252";
    }, {
        readonly name: "decimals";
        readonly type: "core::integer::u8";
    }, {
        readonly name: "initial_supply";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "recipient";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "permitted_minter";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "provisional_governance_admin";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "upgrade_delay";
        readonly type: "core::integer::u64";
    }];
}, {
    readonly type: "function";
    readonly name: "increase_allowance";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "added_value";
        readonly type: "core::integer::u256";
    }];
    readonly outputs: readonly [{
        readonly type: "core::bool";
    }];
    readonly state_mutability: "external";
}, {
    readonly type: "function";
    readonly name: "decrease_allowance";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "subtracted_value";
        readonly type: "core::integer::u256";
    }];
    readonly outputs: readonly [{
        readonly type: "core::bool";
    }];
    readonly state_mutability: "external";
}, {
    readonly type: "function";
    readonly name: "increaseAllowance";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "addedValue";
        readonly type: "core::integer::u256";
    }];
    readonly outputs: readonly [{
        readonly type: "core::bool";
    }];
    readonly state_mutability: "external";
}, {
    readonly type: "function";
    readonly name: "decreaseAllowance";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "subtractedValue";
        readonly type: "core::integer::u256";
    }];
    readonly outputs: readonly [{
        readonly type: "core::bool";
    }];
    readonly state_mutability: "external";
}, {
    readonly type: "event";
    readonly name: "openzeppelin::token::erc20_v070::erc20::ERC20::Transfer";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "from";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "to";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "value";
        readonly type: "core::integer::u256";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "openzeppelin::token::erc20_v070::erc20::ERC20::Approval";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "owner";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "spender";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "value";
        readonly type: "core::integer::u256";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::replaceability_interface::ImplementationAdded";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "implementation_data";
        readonly type: "src::replaceability_interface::ImplementationData";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::replaceability_interface::ImplementationRemoved";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "implementation_data";
        readonly type: "src::replaceability_interface::ImplementationData";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::replaceability_interface::ImplementationReplaced";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "implementation_data";
        readonly type: "src::replaceability_interface::ImplementationData";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::replaceability_interface::ImplementationFinalized";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "impl_hash";
        readonly type: "core::starknet::class_hash::ClassHash";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::access_control_interface::RoleGranted";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "role";
        readonly type: "core::felt252";
        readonly kind: "data";
    }, {
        readonly name: "account";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "sender";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::access_control_interface::RoleRevoked";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "role";
        readonly type: "core::felt252";
        readonly kind: "data";
    }, {
        readonly name: "account";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "sender";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::access_control_interface::RoleAdminChanged";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "role";
        readonly type: "core::felt252";
        readonly kind: "data";
    }, {
        readonly name: "previous_admin_role";
        readonly type: "core::felt252";
        readonly kind: "data";
    }, {
        readonly name: "new_admin_role";
        readonly type: "core::felt252";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::roles_interface::GovernanceAdminAdded";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "added_account";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "added_by";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::roles_interface::GovernanceAdminRemoved";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "removed_account";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "removed_by";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::roles_interface::UpgradeGovernorAdded";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "added_account";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "added_by";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "src::roles_interface::UpgradeGovernorRemoved";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "removed_account";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "removed_by";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "openzeppelin::token::erc20_v070::erc20::ERC20::Event";
    readonly kind: "enum";
    readonly variants: readonly [{
        readonly name: "Transfer";
        readonly type: "openzeppelin::token::erc20_v070::erc20::ERC20::Transfer";
        readonly kind: "nested";
    }, {
        readonly name: "Approval";
        readonly type: "openzeppelin::token::erc20_v070::erc20::ERC20::Approval";
        readonly kind: "nested";
    }, {
        readonly name: "ImplementationAdded";
        readonly type: "src::replaceability_interface::ImplementationAdded";
        readonly kind: "nested";
    }, {
        readonly name: "ImplementationRemoved";
        readonly type: "src::replaceability_interface::ImplementationRemoved";
        readonly kind: "nested";
    }, {
        readonly name: "ImplementationReplaced";
        readonly type: "src::replaceability_interface::ImplementationReplaced";
        readonly kind: "nested";
    }, {
        readonly name: "ImplementationFinalized";
        readonly type: "src::replaceability_interface::ImplementationFinalized";
        readonly kind: "nested";
    }, {
        readonly name: "RoleGranted";
        readonly type: "src::access_control_interface::RoleGranted";
        readonly kind: "nested";
    }, {
        readonly name: "RoleRevoked";
        readonly type: "src::access_control_interface::RoleRevoked";
        readonly kind: "nested";
    }, {
        readonly name: "RoleAdminChanged";
        readonly type: "src::access_control_interface::RoleAdminChanged";
        readonly kind: "nested";
    }, {
        readonly name: "GovernanceAdminAdded";
        readonly type: "src::roles_interface::GovernanceAdminAdded";
        readonly kind: "nested";
    }, {
        readonly name: "GovernanceAdminRemoved";
        readonly type: "src::roles_interface::GovernanceAdminRemoved";
        readonly kind: "nested";
    }, {
        readonly name: "UpgradeGovernorAdded";
        readonly type: "src::roles_interface::UpgradeGovernorAdded";
        readonly kind: "nested";
    }, {
        readonly name: "UpgradeGovernorRemoved";
        readonly type: "src::roles_interface::UpgradeGovernorRemoved";
        readonly kind: "nested";
    }];
}];
