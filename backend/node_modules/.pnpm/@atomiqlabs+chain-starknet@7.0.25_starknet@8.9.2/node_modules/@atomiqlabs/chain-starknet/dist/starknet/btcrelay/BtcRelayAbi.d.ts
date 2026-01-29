export declare const BtcRelayAbi: readonly [{
    readonly type: "impl";
    readonly name: "BtcRelayImpl";
    readonly interface_name: "btc_relay::IBtcRelay";
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
    readonly name: "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>";
    readonly members: readonly [{
        readonly name: "snapshot";
        readonly type: "@core::array::Array::<btc_relay::structs::blockheader::BlockHeader>";
    }];
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
    readonly type: "interface";
    readonly name: "btc_relay::IBtcRelay";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "submit_main_blockheaders";
        readonly inputs: readonly [{
            readonly name: "block_headers";
            readonly type: "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>";
        }, {
            readonly name: "stored_header";
            readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "submit_short_fork_blockheaders";
        readonly inputs: readonly [{
            readonly name: "block_headers";
            readonly type: "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>";
        }, {
            readonly name: "stored_header";
            readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }, {
        readonly type: "function";
        readonly name: "submit_fork_blockheaders";
        readonly inputs: readonly [{
            readonly name: "fork_id";
            readonly type: "core::felt252";
        }, {
            readonly name: "block_headers";
            readonly type: "core::array::Span::<btc_relay::structs::blockheader::BlockHeader>";
        }, {
            readonly name: "stored_header";
            readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        }];
        readonly outputs: readonly [];
        readonly state_mutability: "external";
    }];
}, {
    readonly type: "impl";
    readonly name: "BtcRelayReadOnlyImpl";
    readonly interface_name: "btc_relay::IBtcRelayReadOnly";
}, {
    readonly type: "interface";
    readonly name: "btc_relay::IBtcRelayReadOnly";
    readonly items: readonly [{
        readonly type: "function";
        readonly name: "get_chainwork";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::integer::u256";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_blockheight";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::integer::u32";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "verify_blockheader";
        readonly inputs: readonly [{
            readonly name: "stored_header";
            readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        }];
        readonly outputs: readonly [{
            readonly type: "core::integer::u32";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_commit_hash";
        readonly inputs: readonly [{
            readonly name: "height";
            readonly type: "core::integer::u32";
        }];
        readonly outputs: readonly [{
            readonly type: "core::felt252";
        }];
        readonly state_mutability: "view";
    }, {
        readonly type: "function";
        readonly name: "get_tip_commit_hash";
        readonly inputs: readonly [];
        readonly outputs: readonly [{
            readonly type: "core::felt252";
        }];
        readonly state_mutability: "view";
    }];
}, {
    readonly type: "constructor";
    readonly name: "constructor";
    readonly inputs: readonly [{
        readonly name: "stored_header";
        readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
    }];
}, {
    readonly type: "event";
    readonly name: "btc_relay::events::StoreHeader";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "commit_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "block_hash_poseidon";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "header";
        readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "btc_relay::events::StoreForkHeader";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "commit_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "block_hash_poseidon";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "fork_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "header";
        readonly type: "btc_relay::structs::stored_blockheader::StoredBlockHeader";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "btc_relay::events::ChainReorg";
    readonly kind: "struct";
    readonly members: readonly [{
        readonly name: "fork_submitter";
        readonly type: "core::starknet::contract_address::ContractAddress";
        readonly kind: "key";
    }, {
        readonly name: "fork_id";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "tip_block_hash_poseidon";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "tip_commit_hash";
        readonly type: "core::felt252";
        readonly kind: "key";
    }, {
        readonly name: "start_height";
        readonly type: "core::felt252";
        readonly kind: "data";
    }];
}, {
    readonly type: "event";
    readonly name: "btc_relay::BtcRelay::Event";
    readonly kind: "enum";
    readonly variants: readonly [{
        readonly name: "StoreHeader";
        readonly type: "btc_relay::events::StoreHeader";
        readonly kind: "nested";
    }, {
        readonly name: "StoreForkHeader";
        readonly type: "btc_relay::events::StoreForkHeader";
        readonly kind: "nested";
    }, {
        readonly name: "ChainReorg";
        readonly type: "btc_relay::events::ChainReorg";
        readonly kind: "nested";
    }];
}];
