"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BtcRelayAbi = void 0;
exports.BtcRelayAbi = [
    {
        "type": "impl",
        "name": "BtcRelayImpl",
        "interface_name": "btc_relay::IBtcRelay"
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
        "name": "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>",
        "members": [
            {
                "name": "snapshot",
                "type": "@core::array::Array::<btc_relay::structs::blockheader::BlockHeader>"
            }
        ]
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
        "type": "interface",
        "name": "btc_relay::IBtcRelay",
        "items": [
            {
                "type": "function",
                "name": "submit_main_blockheaders",
                "inputs": [
                    {
                        "name": "block_headers",
                        "type": "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>"
                    },
                    {
                        "name": "stored_header",
                        "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "submit_short_fork_blockheaders",
                "inputs": [
                    {
                        "name": "block_headers",
                        "type": "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>"
                    },
                    {
                        "name": "stored_header",
                        "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            },
            {
                "type": "function",
                "name": "submit_fork_blockheaders",
                "inputs": [
                    {
                        "name": "fork_id",
                        "type": "core::felt252"
                    },
                    {
                        "name": "block_headers",
                        "type": "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>"
                    },
                    {
                        "name": "stored_header",
                        "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader"
                    }
                ],
                "outputs": [],
                "state_mutability": "external"
            }
        ]
    },
    {
        "type": "impl",
        "name": "BtcRelayReadOnlyImpl",
        "interface_name": "btc_relay::IBtcRelayReadOnly"
    },
    {
        "type": "interface",
        "name": "btc_relay::IBtcRelayReadOnly",
        "items": [
            {
                "type": "function",
                "name": "get_chainwork",
                "inputs": [],
                "outputs": [
                    {
                        "type": "core::integer::u256"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_blockheight",
                "inputs": [],
                "outputs": [
                    {
                        "type": "core::integer::u32"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "verify_blockheader",
                "inputs": [
                    {
                        "name": "stored_header",
                        "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::integer::u32"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_commit_hash",
                "inputs": [
                    {
                        "name": "height",
                        "type": "core::integer::u32"
                    }
                ],
                "outputs": [
                    {
                        "type": "core::felt252"
                    }
                ],
                "state_mutability": "view"
            },
            {
                "type": "function",
                "name": "get_tip_commit_hash",
                "inputs": [],
                "outputs": [
                    {
                        "type": "core::felt252"
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
                "name": "stored_header",
                "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader"
            }
        ]
    },
    {
        "type": "event",
        "name": "btc_relay::events::StoreHeader",
        "kind": "struct",
        "members": [
            {
                "name": "commit_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "block_hash_poseidon",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "header",
                "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "btc_relay::events::StoreForkHeader",
        "kind": "struct",
        "members": [
            {
                "name": "commit_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "block_hash_poseidon",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "fork_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "header",
                "type": "btc_relay::structs::stored_blockheader::StoredBlockHeader",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "btc_relay::events::ChainReorg",
        "kind": "struct",
        "members": [
            {
                "name": "fork_submitter",
                "type": "core::starknet::contract_address::ContractAddress",
                "kind": "key"
            },
            {
                "name": "fork_id",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "tip_block_hash_poseidon",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "tip_commit_hash",
                "type": "core::felt252",
                "kind": "key"
            },
            {
                "name": "start_height",
                "type": "core::felt252",
                "kind": "data"
            }
        ]
    },
    {
        "type": "event",
        "name": "btc_relay::BtcRelay::Event",
        "kind": "enum",
        "variants": [
            {
                "name": "StoreHeader",
                "type": "btc_relay::events::StoreHeader",
                "kind": "nested"
            },
            {
                "name": "StoreForkHeader",
                "type": "btc_relay::events::StoreForkHeader",
                "kind": "nested"
            },
            {
                "name": "ChainReorg",
                "type": "btc_relay::events::ChainReorg",
                "kind": "nested"
            }
        ]
    }
];
