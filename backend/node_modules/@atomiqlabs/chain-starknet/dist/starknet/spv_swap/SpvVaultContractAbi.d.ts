export declare const SpvVaultContractAbi: readonly [{
    readonly type: "impl";
    readonly name: "SpvVaultManagerImpl";
    readonly interface_name: "spv_swap_vault::ISpvVaultManager";
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
    readonly name: "spv_swap_vault::structs::BitcoinVaultTransactionData";
    readonly members: readonly [{
        readonly name: "recipient";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "amount";
        readonly type: "(core::integer::u64, core::integer::u64)";
    }, {
        readonly name: "caller_fee";
        readonly type: "(core::integer::u64, core::integer::u64)";
    }, {
        readonly name: "fronting_fee";
        readonly type: "(core::integer::u64, core::integer::u64)";
    }, {
        readonly name: "execution_handler_fee_amount_0";
        readonly type: "core::integer::u64";
    }, {
        readonly name: "execution_hash";
        readonly type: "core::felt252";
    }, {
        readonly name: "execution_expiry";
        readonly type: "core::integer::u32";
    }];
}, {
    readonly type: "struct";
    readonly name: "core::byte_array::ByteArray";
    readonly members: readonly [{
        readonly name: "data";
        readonly type: "core::array::Array::<core::bytes_31::bytes31>";
    }, {
        readonly name: "pending_word";
        readonly type: "core::felt252";
    }, {
        readonly name: "pending_word_len";
        readonly type: "core::integer::u32";
    }];
}, {
    readonly type: "struct";
    readonly name: "btc_relay::structs::blockheader::BlockHeader";
    readonly members: readonly [{
        readonly name: "reversed_version";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "previous_blockhash";
        readonly type: "[core::integer::u32; 8]";
    }, {
        readonly name: "merkle_root";
        readonly type: "[core::integer::u32; 8]";
    }, {
        readonly name: "reversed_timestamp";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "nbits";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "nonce";
        readonly type: "core::integer::u32";
    }];
}, {
    readonly type: "struct";
    readonly name: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
    readonly members: readonly [{
        readonly name: "blockheader";
        readonly type: "btc_relay::structs::blockheader::BlockHeader";
    }, {
        readonly name: "block_hash";
        readonly type: "[core::integer::u32; 8]";
    }, {
        readonly name: "chain_work";
        readonly type: "core::integer::u256";
    }, {
        readonly name: "block_height";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "last_diff_adjustment";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "prev_block_timestamps";
        readonly type: "[core::integer::u32; 10]";
    }];
}, {
    readonly type: "struct";
    readonly name: "core::array::Span::<[core::integer::u32; 8]>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<[core::integer::u32; 8]>";
    }];
}, {
    readonly type: "interface";
    readonly name: "spv_swap_vault::ISpvVaultManager";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "open";
        readonly inputs: readonly [{
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "relay_contract";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "utxo";
            readonly type: "(core::integer::u256, core::integer::u32)";
        }, {
            readonly name: "confirmations";
            readonly type: "core::integer::u8";
        }, {
            readonly name: "token_0";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "token_1";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "token_0_multiplier";
            readonly type: "core::felt252";
        }, {
            readonly name: "token_1_multiplier";
            readonly type: "core::felt252";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "deposit";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "raw_token_0_amount";
            readonly type: "core::integer::u64";
        }, {
            readonly name: "raw_token_1_amount";
            readonly type: "core::integer::u64";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "front";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "withdraw_sequence";
            readonly type: "core::integer::u32";
        }, {
            readonly name: "btc_tx_hash";
            readonly type: "core::integer::u256";
        }, {
            readonly name: "data";
            readonly type: "spv_swap_vault::structs::BitcoinVaultTransactionData";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "claim";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "transaction";
            readonly type: "core::byte_array::ByteArray";
        }, {
            readonly name: "blockheader";
            readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        }, {
            readonly name: "merkle_proof";
            readonly type: "core::array::Span::<[core::integer::u32; 8]>";
        }, {
            readonly name: "position";
            readonly type: "core::integer::u32";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "SpvVaultManagerReadOnlyImpl";
    readonly interface_name: "spv_swap_vault::ISpvVaultManagerReadOnly";
}, {
    readonly type: "struct";
    readonly name: "spv_swap_vault::state::SpvVaultState";
    readonly members: readonly [{
        readonly name: "relay_contract";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "token_0";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "token_1";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }, {
        readonly name: "token_0_multiplier";
        readonly type: "core::felt252";
    }, {
        readonly name: "token_1_multiplier";
        readonly type: "core::felt252";
    }, {
        readonly name: "utxo";
        readonly type: "(core::integer::u256, core::integer::u32)";
    }, {
        readonly name: "confirmations";
        readonly type: "core::integer::u8";
    }, {
        readonly name: "withdraw_count";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "deposit_count";
        readonly type: "core::integer::u32";
    }, {
        readonly name: "token_0_amount";
        readonly type: "core::integer::u64";
    }, {
        readonly name: "token_1_amount";
        readonly type: "core::integer::u64";
    }];
}, {
    readonly type: "enum";
    readonly name: "core::option::Option::<spv_swap_vault::structs::BitcoinVaultTransactionData>";
    readonly variants: readonly [{
        readonly name: "Some";
        readonly type: "spv_swap_vault::structs::BitcoinVaultTransactionData";
    }, {
        readonly name: "None";
        readonly type: "()";
    }];
}, {
    readonly type: "interface";
    readonly name: "spv_swap_vault::ISpvVaultManagerReadOnly";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "get_vault";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }];
        readonly outputs: readonly [{
            readonly type: "spv_swap_vault::state::SpvVaultState";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_fronter_address";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "btc_tx_hash";
            readonly type: "core::integer::u256";
        }, {
            readonly name: "data";
            readonly type: "spv_swap_vault::structs::BitcoinVaultTransactionData";
        }];
        readonly outputs: readonly [{
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_fronter_address_by_id";
        readonly inputs: readonly [{
            readonly name: "owner";
            readonly type: "core::starknet::contract_address::ContractAddress";
        }, {
            readonly name: "vault_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "fronting_id";
            readonly type: "core::felt252";
        }];
        readonly outputs: readonly [{
            readonly type: "core::starknet::contract_address::ContractAddress";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "parse_bitcoin_tx";
        readonly inputs: readonly [{
            readonly name: "transaction";
            readonly type: "core::byte_array::ByteArray";
        }];
        readonly outputs: readonly [{
            readonly type: "core::option::Option::<spv_swap_vault::structs::BitcoinVaultTransactionData>";
        }];
        readonly state_mutability: "view";
    }];
}, {
    readonly type: "constructor";
    readonly name: "constructor";
    readonly inputs: readonly [{
        readonly name: "execution_contract";
        readonly type: "core::starknet::contract_address::ContractAddress";
    }];
}, {
    readonly type: "event";
    readonly name: "spv_swap_vault::events::Opened";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "btc_tx_hash";
        readonly type: "core::integer::u256";
        readonly kind: "key";
    }, {
        readonly name: "owner";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "vault_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "vout";
        readonly type: "core::integer::u32";
        readonly kind: "key";
    }];
}, {
    readonly type: "event";
    readonly name: "spv_swap_vault::events::Deposited";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "owner";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "vault_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "amounts";
        readonly type: "(core::integer::u64, core::integer::u64)";
        readonly kind: "data";
    }, {
        readonly name: "deposit_count";
        readonly type: "core::integer::u32";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "spv_swap_vault::events::Claimed";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "btc_tx_hash";
        readonly type: "core::integer::u256";
        readonly kind: "key";
    }, {
        readonly name: "owner";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "vault_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "recipient";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "execution_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "caller";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "amounts";
        readonly type: "(core::integer::u64, core::integer::u64)";
        readonly kind: "data";
    }, {
        readonly name: "withdraw_count";
        readonly type: "core::integer::u32";
        readonly kind: "data";
    }, {
        readonly name: "fronting_address";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "spv_swap_vault::events::Fronted";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "btc_tx_hash";
        readonly type: "core::integer::u256";
        readonly kind: "key";
    }, {
        readonly name: "owner";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "vault_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "recipient";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "execution_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "caller";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "amounts";
        readonly type: "(core::integer::u64, core::integer::u64)";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "spv_swap_vault::events::Closed";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "btc_tx_hash";
        readonly type: "core::integer::u256";
        readonly kind: "key";
    }, {
        readonly name: "owner";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "vault_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "error";
        readonly type: "core::felt252";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "spv_swap_vault::SpvVaultManager::Event";
    readonly kind: "enum";
    readonly variants: readonly [{
        readonly name: "Opened";
        readonly type: "spv_swap_vault::events::Opened";
        readonly kind: "nested";
    }, {
        readonly name: "Deposited";
        readonly type: "spv_swap_vault::events::Deposited";
        readonly kind: "nested";
    }, {
        readonly name: "Claimed";
        readonly type: "spv_swap_vault::events::Claimed";
        readonly kind: "nested";
    }, {
        readonly name: "Fronted";
        readonly type: "spv_swap_vault::events::Fronted";
        readonly kind: "nested";
    }, {
        readonly name: "Closed";
        readonly type: "spv_swap_vault::events::Closed";
        readonly kind: "nested";
    }];
}];
export type SpvVaultContractAbiType = typeof SpvVaultContractAbi;
