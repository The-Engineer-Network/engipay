"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultContractAbi = void 0;
exports.SpvVaultContractAbi = [
    {
        "type": "impl",
        "name": "SpvVaultManagerImpl",
        "interface_name": "spv_swap_vault::ISpvVaultManager"
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
        "name": "spv_swap_vault::structs::BitcoinVaultTransactionData",
        "members": [
            {
                "name": "recipient",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "amount",
                "type": "(core::integer::u64, core::integer::u64)"
            },
            {
                "name": "caller_fee",
                "type": "(core::integer::u64, core::integer::u64)"
            },
            {
                "name": "fronting_fee",
                "type": "(core::integer::u64, core::integer::u64)"
            },
            {
                "name": "execution_handler_fee_amount_0",
                "type": "core::integer::u64"
            },
            {
                "name": "execution_hash",
                "type": "core::felt252"
            },
            {
                "name": "execution_expiry",
                "type": "core::integer::u32"
            }
        ]
    },
    {
        "type": "struct",
        "name": "core::byte_array::ByteArray",
        "members": [
            {
                "name": "data",
                "type": "core::array::Array::<core::bytes_31::bytes31>"
            },
            {
                "name": "pending_word",
                "type": "core::felt252"
            },
            {
                "name": "pending_word_len",
                "type": "core::integer::u32"
            }
        ]
    },
    {
        "type": "struct",
        "name": "btc_relay::structs::blockheader::BlockHeader",
        "members": [
            {
                "name": "reversed_version",
                "type": "core::integer::u32"
            },
            {
                "name": "previous_blockhash",
                "type": "[core::integer::u32; 8]"
            },
            {
                "name": "merkle_root",
                "type": "[core::integer::u32; 8]"
            },
            {
                "name": "reversed_timestamp",
                "type": "core::integer::u32"
            },
            {
                "name": "nbits",
                "type": "core::integer::u32"
            },
            {
                "name": "nonce",
                "type": "core::integer::u32"
            }
        ]
    },
    {
        "type": "struct",
        "name": "btc_relay::structs::stored_blockheader::StoredBlockHeader",
        "members": [
            {
                "name": "blockheader",
                "type": "btc_relay::structs::blockheader::BlockHeader"
            },
            {
                "name": "block_hash",
                "type": "[core::integer::u32; 8]"
            },
            {
                "name": "chain_work",
                "type": "core::integer::u256"
            },
            {
                "name": "block_height",
                "type": "core::integer::u32"
            },
            {
                "name": "last_diff_adjustment",
                "type": "core::integer::u32"
            },
            {
                "name": "prev_block_timestamps",
                "type": "[core::integer::u32; 10]"
            }
        ]
    },
    {
        "type": "struct",
        "name": "core::array::Span::<[core::integer::u32; 8]>",
        "members": [
            {
                "name": "snapshot",
                "type": "@core::array::Array::<[core::integer::u32; 8]>"
            }
        ]
    },
    {
        "type": "interface",
        "name": "spv_swap_vault::ISpvVaultManager",
        "items": [
            {
                "type": "function",
                "name": "open",
                "inputs": [
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "relay_contract",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "utxo",
                        "type": "(core::integer::u256, core::integer::u32)"
                    },
                    {
                        "name": "confirmations",
                        "type": "core::integer::u8"
                    },
                    {
                        "name": "token_0",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "token_1",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "token_0_multiplier",
                        "type": "core::felt252"
                    },
                    {
                        "name": "token_1_multiplier",
                        "type": "core::felt252"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "deposit",
                "inputs": [
                    {
                        "name": "owner",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "raw_token_0_amount",
                        "type": "core::integer::u64"
                    },
                    {
                        "name": "raw_token_1_amount",
                        "type": "core::integer::u64"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "front",
                "inputs": [
                    {
                        "name": "owner",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "withdraw_sequence",
                        "type": "core::integer::u32"
                    },
                    {
                        "name": "btc_tx_hash",
                        "type": "core::integer::u256"
                    },
                    {
                        "name": "data",
                        "type": "spv_swap_vault::structs::BitcoinVaultTransactionData"
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
                        "name": "owner",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "transaction",
                        "type": "core::byte_array::ByteArray"
                    },
                    {
                        "name": "blockheader",
                        "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader"
                    },
                    {
                        "name": "merkle_proof",
                        "type": "core::array::Span::<[core::integer::u32; 8]>"
                    },
                    {
                        "name": "position",
                        "type": "core::integer::u32"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            }
        ]
    },
    {
        "type": "impl",
        "name": "SpvVaultManagerReadOnlyImpl",
        "interface_name": "spv_swap_vault::ISpvVaultManagerReadOnly"
    },
    {
        "type": "struct",
        "name": "spv_swap_vault::state::SpvVaultState",
        "members": [
            {
                "name": "relay_contract",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "token_0",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "token_1",
                "type": "core::starknet::contract_address::ContractAddress"
            },
            {
                "name": "token_0_multiplier",
                "type": "core::felt252"
            },
            {
                "name": "token_1_multiplier",
                "type": "core::felt252"
            },
            {
                "name": "utxo",
                "type": "(core::integer::u256, core::integer::u32)"
            },
            {
                "name": "confirmations",
                "type": "core::integer::u8"
            },
            {
                "name": "withdraw_count",
                "type": "core::integer::u32"
            },
            {
                "name": "deposit_count",
                "type": "core::integer::u32"
            },
            {
                "name": "token_0_amount",
                "type": "core::integer::u64"
            },
            {
                "name": "token_1_amount",
                "type": "core::integer::u64"
            }
        ]
    },
    {
        "type": "enum",
        "name": "core::option::Option::<spv_swap_vault::structs::BitcoinVaultTransactionData>",
        "variants": [
            {
                "name": "Some",
                "type": "spv_swap_vault::structs::BitcoinVaultTransactionData"
            },
            {
                "name": "None",
                "type": "()"
            }
        ]
    },
    {
        "type": "interface",
        "name": "spv_swap_vault::ISpvVaultManagerReadOnly",
        "items": [
            {
                "type": "function",
                "name": "get_vault",
                "inputs": [
                    {
                        "name": "owner",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    }
                ],
                "outputs": [
                    {
                        "type": "spv_swap_vault::state::SpvVaultState"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_fronter_address",
                "inputs": [
                    {
                        "name": "owner",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "btc_tx_hash",
                        "type": "core::integer::u256"
                    },
                    {
                        "name": "data",
                        "type": "spv_swap_vault::structs::BitcoinVaultTransactionData"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::starknet::contract_address::ContractAddress"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_fronter_address_by_id",
                "inputs": [
                    {
                        "name": "owner",
                        "type": "core::starknet::contract_address::ContractAddress"
                    },
                    {
                        "name": "vault_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "fronting_id",
                        "type": "core::felt252"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::starknet::contract_address::ContractAddress"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "parse_bitcoin_tx",
                "inputs": [
                    {
                        "name": "transaction",
                        "type": "core::byte_array::ByteArray"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::option::Option::<spv_swap_vault::structs::BitcoinVaultTransactionData>"
                    }
                ],
                "state_mutability": "view"
            }
        ]
    },
    {
        "type": "constructor",
        "name": "constructor",
        "inputs": [
            {
                "name": "execution_contract",
                "type": "core::starknet::contract_address::ContractAddress"
            }
        ]
    },
    {
        "type": "event",
        "name": "spv_swap_vault::events::Opened",
        "kind": "struct",
        "members": [
            {
                "name": "btc_tx_hash",
                "type": "core::integer::u256",
                "kind": "key"
            },
            {
                "name": "owner",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "vault_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "vout",
                "type": "core::integer::u32",
                "kind": "key"
            }
        ]
    },
    {
        "type": "event",
        "name": "spv_swap_vault::events::Deposited",
        "kind": "struct",
        "members": [
            {
                "name": "owner",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "vault_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "amounts",
                "type": "(core::integer::u64, core::integer::u64)",
                "kind": "data"
            },
            {
                "name": "deposit_count",
                "type": "core::integer::u32",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "spv_swap_vault::events::Claimed",
        "kind": "struct",
        "members": [
            {
                "name": "btc_tx_hash",
                "type": "core::integer::u256",
                "kind": "key"
            },
            {
                "name": "owner",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "vault_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "recipient",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "execution_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "caller",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "amounts",
                "type": "(core::integer::u64, core::integer::u64)",
                "kind": "data"
            },
            {
                "name": "withdraw_count",
                "type": "core::integer::u32",
                "kind": "data"
            },
            {
                "name": "fronting_address",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "spv_swap_vault::events::Fronted",
        "kind": "struct",
        "members": [
            {
                "name": "btc_tx_hash",
                "type": "core::integer::u256",
                "kind": "key"
            },
            {
                "name": "owner",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "vault_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "recipient",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "execution_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "caller",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "amounts",
                "type": "(core::integer::u64, core::integer::u64)",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "spv_swap_vault::events::Closed",
        "kind": "struct",
        "members": [
            {
                "name": "btc_tx_hash",
                "type": "core::integer::u256",
                "kind": "key"
            },
            {
                "name": "owner",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "vault_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "error",
                "type": "core::felt252",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "spv_swap_vault::SpvVaultManager::Event",
        "kind": "enum",
        "variants": [
            {
                "name": "Opened",
                "type": "spv_swap_vault::events::Opened",
                "kind": "nested"
            },
            {
                "name": "Deposited",
                "type": "spv_swap_vault::events::Deposited",
                "kind": "nested"
            },
            {
                "name": "Claimed",
                "type": "spv_swap_vault::events::Claimed",
                "kind": "nested"
            },
            {
                "name": "Fronted",
                "type": "spv_swap_vault::events::Fronted",
                "kind": "nested"
            },
            {
                "name": "Closed",
                "type": "spv_swap_vault::events::Closed",
                "kind": "nested"
            }
        ]
    }
];
