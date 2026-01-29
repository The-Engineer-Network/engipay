export declare const EscrowManagerAbi: readonly [{
    readonly type: "impl";
    readonly name: "EscrowManagerImpl";
    readonly interface_name: "escrow_manager::IEscrowManager";
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
    readonly type: "struct";
    readonly name: "escrow_manager::structs::escrow::EscrowExecution";
    readonly members: readonly [{
        readonly name: "hash";
        readonly type: "core::felt252";
    }, {
        readonly name: "expiry";
        readonly type: "core::integer::u64";
    }, {
        readonly name: "fee";
        readonly type: "core::integer::u256";
    }];
}, {
    readonly type: "enum";
    readonly name: "core::option::Option::<escrow_manager::structs::escrow::EscrowExecution>";
    readonly variants: readonly [{
        readonly name: "Some";
        readonly type: "escrow_manager::structs::escrow::EscrowExecution";
    }, {
        readonly name: "None";
        readonly type: "()";
    }];
}, {
    readonly type: "struct";
    readonly name: "escrow_manager::structs::escrow::EscrowData";
    readonly members: readonly [{
        readonly name: "offerer";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "claimer";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "token";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "refund_handler";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "claim_handler";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "flags";
        readonly type: "core::integer::u128";
    }, {
        readonly name: "claim_data";
        readonly type: "core::felt252";
    }, {
        readonly name: "refund_data";
        readonly type: "core::felt252";
    }, {
        readonly name: "amount";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "fee_token";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "security_deposit";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "claimer_bounty";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "success_action";
        readonly type: "core::option::Option::<escrow_manager::structs::escrow::EscrowExecution>";
    }];
}, {
    readonly type: "struct";
    readonly name: "core::array::Span::<core::felt252>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<core::felt252>";
    }];
}, {
    readonly type: "interface";
    readonly name: "escrow_manager::IEscrowManager";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "initialize";
        readonly inputs: readonly [{
            readonly name: "escrow";
            readonly type: "escrow_manager::structs::escrow::EscrowData";
        }, {
            readonly name: "signature";
            readonly type: "core::array::Array::<core::felt252>";
        }, {
            readonly name: "timeout";
            readonly type: "core::integer::u64";
        }, {
            readonly name: "extra_data";
            readonly type: "core::array::Span::<core::felt252>";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "claim";
        readonly inputs: readonly [{
            readonly name: "escrow";
            readonly type: "escrow_manager::structs::escrow::EscrowData";
        }, {
            readonly name: "witness";
            readonly type: "core::array::Array::<core::felt252>";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "refund";
        readonly inputs: readonly [{
            readonly name: "escrow";
            readonly type: "escrow_manager::structs::escrow::EscrowData";
        }, {
            readonly name: "witness";
            readonly type: "core::array::Array::<core::felt252>";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "cooperative_refund";
        readonly inputs: readonly [{
            readonly name: "escrow";
            readonly type: "escrow_manager::structs::escrow::EscrowData";
        }, {
            readonly name: "signature";
            readonly type: "core::array::Array::<core::felt252>";
        }, {
            readonly name: "timeout";
            readonly type: "core::integer::u64";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "LPVaultImpl";
    readonly interface_name: "escrow_manager::components::lp_vault::ILPVault";
}, {
    readonly type: "struct";
    readonly name: "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>";
    }];
}, {
    readonly type: "interface";
    readonly name: "escrow_manager::components::lp_vault::ILPVault";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "deposit";
        readonly inputs: readonly [{
            readonly name: "token";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "withdraw";
        readonly inputs: readonly [{
            readonly name: "token";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "amount";
            readonly type: "core::integer::u256";
        }, {
            readonly name: "destination";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "get_balance";
        readonly inputs: readonly [{
            readonly name: "data";
            readonly type: "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>";
        }];
        readonly outputs: readonly [{
            readonly type: "core::array::Array::<core::integer::u256>";
        }];
        readonly state_mutability: "view";
    }];
}, {
    readonly type: "impl";
    readonly name: "ReputationTrackerImpl";
    readonly interface_name: "escrow_manager::components::reputation::IReputationTracker";
}, {
    readonly type: "struct";
    readonly name: "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>";
    }];
}, {
    readonly type: "struct";
    readonly name: "escrow_manager::state::reputation::Reputation";
    readonly members: readonly [{
        readonly name: "amount";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "count";
        readonly type: "core::integer::u128";
    }];
}, {
    readonly type: "interface";
    readonly name: "escrow_manager::components::reputation::IReputationTracker";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "get_reputation";
        readonly inputs: readonly [{
            readonly name: "data";
            readonly type: "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>";
        }];
        readonly outputs: readonly [{
            readonly type: "core::array::Array::<[escrow_manager::state::reputation::Reputation; 3]>";
        }];
        readonly state_mutability: "view";
    }];
}, {
    readonly type: "impl";
    readonly name: "EscrowStorageImpl";
    readonly interface_name: "escrow_manager::components::escrow_storage::IEscrowStorage";
}, {
    readonly type: "struct";
    readonly name: "escrow_manager::state::escrow::EscrowState";
    readonly members: readonly [{
        readonly name: "init_blockheight";
        readonly type: "core::integer::u64";
    }, {
        readonly name: "finish_blockheight";
        readonly type: "core::integer::u64";
    }, {
        readonly name: "state";
        readonly type: "core::integer::u8";
    }];
}, {
    readonly type: "struct";
    readonly name: "core::array::Span::<escrow_manager::state::escrow::EscrowState>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<escrow_manager::state::escrow::EscrowState>";
    }];
}, {
    readonly type: "interface";
    readonly name: "escrow_manager::components::escrow_storage::IEscrowStorage";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "get_state";
        readonly inputs: readonly [{
            readonly name: "escrow";
            readonly type: "escrow_manager::structs::escrow::EscrowData";
        }];
        readonly outputs: readonly [{
            readonly type: "escrow_manager::state::escrow::EscrowState";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_hash_state";
        readonly inputs: readonly [{
            readonly name: "escrow_hash";
            readonly type: "core::felt252";
        }];
        readonly outputs: readonly [{
            readonly type: "escrow_manager::state::escrow::EscrowState";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_hash_state_multiple";
        readonly inputs: readonly [{
            readonly name: "escrow_hashes";
            readonly type: "core::array::Span::<core::felt252>";
        }];
        readonly outputs: readonly [{
            readonly type: "core::array::Span::<escrow_manager::state::escrow::EscrowState>";
        }];
        readonly state_mutability: "view";
    }];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::components::lp_vault::lp_vault::Event";
    readonly kind: "enum";
    readonly variants: readonly [];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::components::reputation::reputation::Event";
    readonly kind: "enum";
    readonly variants: readonly [];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::components::escrow_storage::escrow_storage::Event";
    readonly kind: "enum";
    readonly variants: readonly [];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::events::Initialize";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "offerer";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "claimer";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "claim_data";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "escrow_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "claim_handler";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }, {
        readonly name: "refund_handler";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::events::Claim";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "offerer";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "claimer";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "claim_data";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "escrow_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "witness_result";
        readonly type: "core::array::Span::<core::felt252>";
        readonly kind: "data";
    }, {
        readonly name: "claim_handler";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::events::Refund";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "offerer";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "claimer";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "claim_data";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "escrow_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "witness_result";
        readonly type: "core::array::Span::<core::felt252>";
        readonly kind: "data";
    }, {
        readonly name: "refund_handler";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "escrow_manager::EscrowManager::Event";
    readonly kind: "enum";
    readonly variants: readonly [{
        readonly name: "LPVaultEvent";
        readonly type: "escrow_manager::components::lp_vault::lp_vault::Event";
        readonly kind: "nested";
    }, {
        readonly name: "ReputationTrackerEvent";
        readonly type: "escrow_manager::components::reputation::reputation::Event";
        readonly kind: "nested";
    }, {
        readonly name: "EscrowStorageEvent";
        readonly type: "escrow_manager::components::escrow_storage::escrow_storage::Event";
        readonly kind: "nested";
    }, {
        readonly name: "Initialize";
        readonly type: "escrow_manager::events::Initialize";
        readonly kind: "nested";
    }, {
        readonly name: "Claim";
        readonly type: "escrow_manager::events::Claim";
        readonly kind: "nested";
    }, {
        readonly name: "Refund";
        readonly type: "escrow_manager::events::Refund";
        readonly kind: "nested";
    }];
}];
export type EscrowManagerAbiType = typeof EscrowManagerAbi;
