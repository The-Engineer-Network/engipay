"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EscrowManagerAbi = void 0;
exports.EscrowManagerAbi = [
    {
        "type": "impl",
        "name": "EscrowManagerImpl",
        "interface_name": "escrow_manager::IEscrowManager"
    },
    {
        "type": "struct",
        "name": "core::integer::u256",
        "members": [
            {
                "name": "low",
                "type": "core::integer::u128"
            },
            {
                "name": "high",
                "type": "core::integer::u128"
            }
        ]
    },
    {
        "type": "struct",
        "name": "escrow_manager::structs::escrow::EscrowExecution",
        "members": [
            {
                "name": "hash",
                "type": "core::felt252"
            },
            {
                "name": "expiry",
                "type": "core::integer::u64"
            },
            {
                "name": "fee",
                "type": "core::integer::u256"
            }
        ]
    },
    {
        "type": "enum",
        "name": "core::option::Option::<escrow_manager::structs::escrow::EscrowExecution>",
        "variants": [
            {
                "name": "Some",
                "type": "escrow_manager::structs::escrow::EscrowExecution"
            },
            {
                "name": "None",
                "type": "()"
            }
        ]
    },
    {
        "type": "struct",
        "name": "escrow_manager::structs::escrow::EscrowData",
        "members": [
            {
                "name": "offerer",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "claimer",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "token",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "refund_handler",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "claim_handler",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "flags",
                "type": "core::integer::u128"
            },
            {
                "name": "claim_data",
                "type": "core::felt252"
            },
            {
                "name": "refund_data",
                "type": "core::felt252"
            },
            {
                "name": "amount",
                "type": "core::integer::u256"
            },
            {
                "name": "fee_token",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "security_deposit",
                "type": "core::integer::u256"
            },
            {
                "name": "claimer_bounty",
                "type": "core::integer::u256"
            },
            {
                "name": "success_action",
                "type": "core::option::Option::<escrow_manager::structs::escrow::EscrowExecution>"
            }
        ]
    },
    {
        "type": "struct",
        "name": "core::array::Span::<core::felt252>",
        "members": [
            {
                "name": "snapshot",
                "type": "@core::array::Array::<core::felt252>"
            }
        ]
    },
    {
        "type": "interface",
        "name": "escrow_manager::IEscrowManager",
        "items": [
            {
                "type": "function",
                "name": "initialize",
                "inputs": [
                    {
                        "name": "escrow",
                        "type": "escrow_manager::structs::escrow::EscrowData"
                    },
                    {
                        "name": "signature",
                        "type": "core::array::Array::<core::felt252>"
                    },
                    {
                        "name": "timeout",
                        "type": "core::integer::u64"
                    },
                    {
                        "name": "extra_data",
                        "type": "core::array::Span::<core::felt252>"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "claim",
                "inputs": [
                    {
                        "name": "escrow",
                        "type": "escrow_manager::structs::escrow::EscrowData"
                    },
                    {
                        "name": "witness",
                        "type": "core::array::Array::<core::felt252>"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "refund",
                "inputs": [
                    {
                        "name": "escrow",
                        "type": "escrow_manager::structs::escrow::EscrowData"
                    },
                    {
                        "name": "witness",
                        "type": "core::array::Array::<core::felt252>"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "cooperative_refund",
                "inputs": [
                    {
                        "name": "escrow",
                        "type": "escrow_manager::structs::escrow::EscrowData"
                    },
                    {
                        "name": "signature",
                        "type": "core::array::Array::<core::felt252>"
                    },
                    {
                        "name": "timeout",
                        "type": "core::integer::u64"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            }
        ]
    },
    {
        "type": "impl",
        "name": "LPVaultImpl",
        "interface_name": "escrow_manager::components::lp_vault::ILPVault"
    },
    {
        "type": "struct",
        "name": "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>",
        "members": [
            {
                "name": "snapshot",
                "type": "@core::array::Array::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>"
            }
        ]
    },
    {
        "type": "interface",
        "name": "escrow_manager::components::lp_vault::ILPVault",
        "items": [
            {
                "type": "function",
                "name": "deposit",
                "inputs": [
                    {
                        "name": "token",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "amount",
                        "type": "core::integer::u256"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "withdraw",
                "inputs": [
                    {
                        "name": "token",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "amount",
                        "type": "core::integer::u256"
                    },
                    {
                        "name": "destination",
                        "type": "core::starknet::contract_address::ContractAddress"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "get_balance",
                "inputs": [
                    {
                        "name": "data",
                        "type": "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::array::Array::<core::integer::u256>"
                    }
                ],
                "state_mutability": "view"
            }
        ]
    },
    {
        "type": "impl",
        "name": "ReputationTrackerImpl",
        "interface_name": "escrow_manager::components::reputation::IReputationTracker"
    },
    {
        "type": "struct",
        "name": "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>",
        "members": [
            {
                "name": "snapshot",
                "type": "@core::array::Array::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>"
            }
        ]
    },
    {
        "type": "struct",
        "name": "escrow_manager::state::reputation::Reputation",
        "members": [
            {
                "name": "amount",
                "type": "core::integer::u256"
            },
            {
                "name": "count",
                "type": "core::integer::u128"
            }
        ]
    },
    {
        "type": "interface",
        "name": "escrow_manager::components::reputation::IReputationTracker",
        "items": [
            {
                "type": "function",
                "name": "get_reputation",
                "inputs": [
                    {
                        "name": "data",
                        "type": "core::array::Span::<(core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress, core::starknet::contract_address::ContractAddress)>"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::array::Array::<[escrow_manager::state::reputation::Reputation; 3]>"
                    }
                ],
                "state_mutability": "view"
            }
        ]
    },
    {
        "type": "impl",
        "name": "EscrowStorageImpl",
        "interface_name": "escrow_manager::components::escrow_storage::IEscrowStorage"
    },
    {
        "type": "struct",
        "name": "escrow_manager::state::escrow::EscrowState",
        "members": [
            {
                "name": "init_blockheight",
                "type": "core::integer::u64"
            },
            {
                "name": "finish_blockheight",
                "type": "core::integer::u64"
            },
            {
                "name": "state",
                "type": "core::integer::u8"
            }
        ]
    },
    {
        "type": "struct",
        "name": "core::array::Span::<escrow_manager::state::escrow::EscrowState>",
        "members": [
            {
                "name": "snapshot",
                "type": "@core::array::Array::<escrow_manager::state::escrow::EscrowState>"
            }
        ]
    },
    {
        "type": "interface",
        "name": "escrow_manager::components::escrow_storage::IEscrowStorage",
        "items": [
            {
                "type": "function",
                "name": "get_state",
                "inputs": [
                    {
                        "name": "escrow",
                        "type": "escrow_manager::structs::escrow::EscrowData"
                    }
                ],
                "outputs": [
                    {
                        "type": "escrow_manager::state::escrow::EscrowState"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_hash_state",
                "inputs": [
                    {
                        "name": "escrow_hash",
                        "type": "core::felt252"
                    }
                ],
                "outputs": [
                    {
                        "type": "escrow_manager::state::escrow::EscrowState"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_hash_state_multiple",
                "inputs": [
                    {
                        "name": "escrow_hashes",
                        "type": "core::array::Span::<core::felt252>"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::array::Span::<escrow_manager::state::escrow::EscrowState>"
                    }
                ],
                "state_mutability": "view"
            }
        ]
    },
    {
        "type": "event",
        "name": "escrow_manager::components::lp_vault::lp_vault::Event",
        "kind": "enum",
        "variants": []
    },
    {
        "type": "event",
        "name": "escrow_manager::components::reputation::reputation::Event",
        "kind": "enum",
        "variants": []
    },
    {
        "type": "event",
        "name": "escrow_manager::components::escrow_storage::escrow_storage::Event",
        "kind": "enum",
        "variants": []
    },
    {
        "type": "event",
        "name": "escrow_manager::events::Initialize",
        "kind": "struct",
        "members": [
            {
                "name": "offerer",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "claimer",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "claim_data",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "escrow_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "claim_handler",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "data"
            },
            {
                "name": "refund_handler",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "escrow_manager::events::Claim",
        "kind": "struct",
        "members": [
            {
                "name": "offerer",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "claimer",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "claim_data",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "escrow_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "witness_result",
                "type": "core::array::Span::<core::felt252>",
                "kind": "data"
            },
            {
                "name": "claim_handler",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "escrow_manager::events::Refund",
        "kind": "struct",
        "members": [
            {
                "name": "offerer",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "claimer",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "claim_data",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "escrow_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "witness_result",
                "type": "core::array::Span::<core::felt252>",
                "kind": "data"
            },
            {
                "name": "refund_handler",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "escrow_manager::EscrowManager::Event",
        "kind": "enum",
        "variants": [
            {
                "name": "LPVaultEvent",
                "type": "escrow_manager::components::lp_vault::lp_vault::Event",
                "kind": "nested"
            },
            {
                "name": "ReputationTrackerEvent",
                "type": "escrow_manager::components::reputation::reputation::Event",
                "kind": "nested"
            },
            {
                "name": "EscrowStorageEvent",
                "type": "escrow_manager::components::escrow_storage::escrow_storage::Event",
                "kind": "nested"
            },
            {
                "name": "Initialize",
                "type": "escrow_manager::events::Initialize",
                "kind": "nested"
            },
            {
                "name": "Claim",
                "type": "escrow_manager::events::Claim",
                "kind": "nested"
            },
            {
                "name": "Refund",
                "type": "escrow_manager::events::Refund",
                "kind": "nested"
            }
        ]
    }
];
