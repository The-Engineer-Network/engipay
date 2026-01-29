# atomiqlabs SDK sqlite storage adapter

Storage adapter for atomiqlabs SDK to be used in the NodeJS environment, uses Sqlite3 as a storage backend.

## Installation

```
npm install @atomiqlabs/sdk
npm install @atomiqlabs/storage-sqlite
```

## Initializing a swapper

```typescript
import {SqliteStorageManager, SqliteUnifiedStorage} from "@atomiqlabs/storage-sqlite";
import {BitcoinNetwork} from "@atomiqlabs/sdk";

const swapper = Factory.newSwapper({
    chains: {
        SOLANA: {
            rpcUrl: solanaRpc //You can also pass Connection object here
        },
        STARKNET: {
            rpcUrl: starknetRpc //You can also pass Provider object here
        }
    },
    bitcoinNetwork: BitcoinNetwork.TESTNET, //or BitcoinNetwork.MAINNET - this also sets the network to use for Solana (solana devnet for bitcoin testnet) & Starknet (sepolia for bitcoin testnet)
    //The following lines are important for running on backend node.js,
    // because the SDK by default uses browser's Indexed DB
    swapStorage: chainId => new SqliteUnifiedStorage("CHAIN_"+chainId+".sqlite3"),
    chainStorageCtor: name => new SqliteStorageManager("STORE_"+name+".sqlite3"),
});
```