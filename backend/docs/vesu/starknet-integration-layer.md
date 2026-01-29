# Starknet Integration Layer Documentation

## Overview

The Starknet Integration Layer provides a robust interface for interacting with Vesu V2 lending protocol contracts on the Starknet blockchain. It consists of two main components:

1. **StarknetContractManager** - Manages contract instances, ABIs, and method calls
2. **TransactionManager** - Handles transaction lifecycle including signing, submission, and confirmation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Application Layer                          │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│           Starknet Integration Layer                        │
│  ┌──────────────────────┐  ┌──────────────────────────┐    │
│  │ StarknetContract     │  │  TransactionManager      │    │
│  │ Manager              │  │                          │    │
│  │ - ABI Loading        │  │  - Gas Estimation        │    │
│  │ - Contract Caching   │  │  - Transaction Signing   │    │
│  │ - Method Calls       │  │  - Submission & Retry    │    │
│  │ - Error Handling     │  │  - Confirmation Monitor  │    │
│  └──────────────────────┘  └──────────────────────────┘    │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              Starknet Network (RPC)                         │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. StarknetContractManager

Manages all contract interactions with Vesu V2 Pool and vToken contracts.

#### Features

- **ABI Management**: Loads and caches contract ABIs from JSON files
- **Contract Initialization**: Creates and caches contract instances
- **Method Calls**: Provides wrapper methods for safe contract calls
- **Error Handling**: Parses and enhances Starknet error messages
- **Address Validation**: Validates Starknet address formats

#### Usage Example

```javascript
const StarknetContractManager = require('./services/StarknetContractManager');
const { getStarknetProvider } = require('./config/starknet');

// Initialize
const provider = getStarknetProvider();
const contractManager = new StarknetContractManager(provider);

// Call Pool contract method
const poolAddress = '0x...';
const position = await contractManager.callPoolMethod(
  poolAddress,
  'position',
  [collateralAsset, debtAsset, userAddress]
);

// Call vToken contract method
const vTokenAddress = '0x...';
const balance = await contractManager.callVTokenMethod(
  vTokenAddress,
  'balanceOf',
  [userAddress]
);

// Get exchange rate
const exchangeRate = await contractManager.getVTokenExchangeRate(vTokenAddress);
```

#### Key Methods

##### `loadPoolABI()`
Loads Pool contract ABI from `backend/abis/pool-abi.json`. Results are cached.

**Returns:** `Array` - Pool contract ABI

##### `loadVTokenABI()`
Loads vToken contract ABI from `backend/abis/vtoken-abi.json`. Results are cached.

**Returns:** `Array` - vToken contract ABI

##### `initializePoolContract(poolAddress)`
Initializes a Pool contract instance. Instances are cached by address.

**Parameters:**
- `poolAddress` (string) - Pool contract address

**Returns:** `Promise<Contract>` - Pool contract instance

##### `initializeVTokenContract(vTokenAddress)`
Initializes a vToken contract instance. Instances are cached by address.

**Parameters:**
- `vTokenAddress` (string) - vToken contract address

**Returns:** `Promise<Contract>` - vToken contract instance

##### `callPoolMethod(poolAddress, method, params)`
Calls a Pool contract method with error handling.

**Parameters:**
- `poolAddress` (string) - Pool contract address
- `method` (string) - Method name to call
- `params` (Array) - Method parameters (default: [])

**Returns:** `Promise<any>` - Method call result

**Throws:** Enhanced error with context

##### `callVTokenMethod(vTokenAddress, method, params)`
Calls a vToken contract method with error handling.

**Parameters:**
- `vTokenAddress` (string) - vToken contract address
- `method` (string) - Method name to call
- `params` (Array) - Method parameters (default: [])

**Returns:** `Promise<any>` - Method call result

**Throws:** Enhanced error with context

##### `getVTokenExchangeRate(vTokenAddress)`
Calculates vToken exchange rate (assets per share).

**Parameters:**
- `vTokenAddress` (string) - vToken contract address

**Returns:** `Promise<string>` - Exchange rate as string (preserves precision)

##### `isValidAddress(address)`
Validates Starknet address format.

**Parameters:**
- `address` (string) - Address to validate

**Returns:** `boolean` - True if valid

##### `clearCache()`
Clears all cached contract instances. Useful for testing or contract upgrades.

##### `getCacheStats()`
Returns cache statistics.

**Returns:** `Object` - Cache statistics
```javascript
{
  poolContracts: number,
  vTokenContracts: number,
  totalCached: number
}
```

### 2. TransactionManager

Manages the complete transaction lifecycle on Starknet.

#### Features

- **Gas Estimation**: Estimates transaction fees with configurable safety buffer
- **Account Abstraction**: Handles transaction signing using Starknet accounts
- **Retry Logic**: Automatically retries failed transactions with exponential backoff
- **Confirmation Monitoring**: Waits for transaction confirmation with timeout
- **Status Tracking**: Queries transaction status and execution results
- **Error Classification**: Identifies retryable vs non-retryable errors

#### Configuration

Configuration is loaded from `backend/config/vesu.config.js`:

```javascript
transaction: {
  maxRetries: 3,              // Maximum retry attempts
  retryDelay: 5000,           // Delay between retries (ms)
  confirmationTimeout: 300000, // Max wait for confirmation (ms)
  gasMultiplier: 1.1          // Gas estimation safety buffer
}
```

#### Usage Example

```javascript
const TransactionManager = require('./services/TransactionManager');
const { getStarknetProvider } = require('./config/starknet');

// Initialize
const provider = getStarknetProvider();
const txManager = new TransactionManager(
  provider,
  process.env.STARKNET_ACCOUNT_ADDRESS,
  process.env.STARKNET_PRIVATE_KEY
);

// Estimate gas
const gasEstimate = await txManager.estimateGas(
  contractAddress,
  'modify_position',
  [params]
);

// Submit transaction
const result = await txManager.submitTransaction(
  contractAddress,
  'modify_position',
  [params],
  { maxFee: gasEstimate.suggestedMaxFee }
);

// Wait for confirmation
const receipt = await txManager.waitForConfirmation(result.transaction_hash);

// Or use convenience method
const confirmedTx = await txManager.submitAndWait(
  contractAddress,
  'modify_position',
  [params]
);
```

#### Key Methods

##### `estimateGas(contractAddress, method, params)`
Estimates gas for a transaction with safety buffer.

**Parameters:**
- `contractAddress` (string) - Target contract address
- `method` (string) - Method to call
- `params` (Array) - Method parameters (default: [])

**Returns:** `Promise<Object>` - Gas estimation
```javascript
{
  overall_fee: BigInt,
  gas_consumed: BigInt,
  gas_price: BigInt,
  suggestedMaxFee: BigInt
}
```

##### `submitTransaction(contractAddress, method, params, options)`
Submits a transaction with automatic retry logic.

**Parameters:**
- `contractAddress` (string) - Target contract address
- `method` (string) - Method to call
- `params` (Array) - Method parameters (default: [])
- `options` (Object) - Additional options
  - `maxFee` (BigInt) - Maximum fee to pay

**Returns:** `Promise<Object>` - Transaction result
```javascript
{
  transaction_hash: string,
  status: 'PENDING',
  attempt: number
}
```

##### `waitForConfirmation(transactionHash, maxWait)`
Waits for transaction confirmation.

**Parameters:**
- `transactionHash` (string) - Transaction hash to monitor
- `maxWait` (number) - Maximum wait time in ms (default: from config)

**Returns:** `Promise<Object>` - Transaction receipt
```javascript
{
  transaction_hash: string,
  status: 'CONFIRMED',
  execution_status: string,
  block_number: number,
  receipt: Object
}
```

**Throws:** Error if transaction reverts or times out

##### `getTransactionStatus(transactionHash)`
Gets current transaction status.

**Parameters:**
- `transactionHash` (string) - Transaction hash

**Returns:** `Promise<Object>` - Transaction status
```javascript
{
  transaction_hash: string,
  status: string,
  block_number: number,
  finality_status: string,
  execution_status: string
}
```

##### `executeWithRetry(operation, maxRetries)`
Executes any async operation with retry logic.

**Parameters:**
- `operation` (Function) - Async function to execute
- `maxRetries` (number) - Maximum retry attempts (default: 3)

**Returns:** `Promise<any>` - Operation result

##### `submitAndWait(contractAddress, method, params, options)`
Convenience method that submits and waits for confirmation.

**Parameters:**
- Same as `submitTransaction`

**Returns:** `Promise<Object>` - Confirmed transaction result

##### `estimateAndSubmit(contractAddress, method, params)`
Convenience method that estimates gas and submits transaction.

**Parameters:**
- `contractAddress` (string) - Target contract address
- `method` (string) - Method to call
- `params` (Array) - Method parameters

**Returns:** `Promise<Object>` - Transaction result

## ABIs

Contract ABIs are stored in `backend/abis/`:

- `pool-abi.json` - Vesu V2 Pool contract ABI
- `vtoken-abi.json` - Vesu V2 vToken (ERC-4626) contract ABI

### Pool Contract ABI

Key functions:
- `modify_position(params)` - Modify user position (supply, borrow, repay, withdraw)
- `position(collateral_asset, debt_asset, user)` - Get position state
- `liquidate_position(params)` - Liquidate undercollateralized position
- `asset_config(asset)` - Get asset configuration

### vToken Contract ABI

Key functions (ERC-4626 standard):
- `deposit(assets, receiver)` - Deposit assets, receive shares
- `withdraw(assets, receiver, owner)` - Withdraw assets, burn shares
- `mint(shares, receiver)` - Mint exact shares
- `redeem(shares, receiver, owner)` - Redeem exact shares
- `asset()` - Get underlying asset address
- `totalAssets()` - Get total managed assets
- `convertToShares(assets)` - Convert assets to shares
- `convertToAssets(shares)` - Convert shares to assets
- `balanceOf(account)` - Get share balance

## Error Handling

### StarknetContractManager Errors

The manager parses Starknet errors and provides enhanced messages:

- **Contract not found** - Invalid contract address or contract not deployed
- **Method not found** - Method doesn't exist on contract
- **Invalid parameters** - Parameters don't match method signature
- **Execution failed** - Contract execution reverted

### TransactionManager Errors

The manager classifies errors as retryable or non-retryable:

**Retryable Errors:**
- Network errors
- Timeouts
- Rate limiting
- Service unavailable

**Non-Retryable Errors:**
- Invalid parameters
- Contract not found
- Insufficient balance
- Transaction reverted

## Environment Variables

Required environment variables:

```bash
# Starknet Configuration
STARKNET_NETWORK=sepolia
STARKNET_RPC_URL=https://starknet-sepolia.infura.io/v3/YOUR_KEY

# Account Configuration (for TransactionManager)
STARKNET_ACCOUNT_ADDRESS=0x...
STARKNET_PRIVATE_KEY=0x...
```

## Testing

Run tests:

```bash
cd backend
npm test -- starknet-integration.test.js
```

Test coverage includes:
- Contract manager initialization
- ABI loading and caching
- Address validation
- Contract instance caching
- Transaction manager initialization
- Error classification
- Configuration loading

## Best Practices

### 1. Contract Manager

- **Cache Reuse**: Contract instances are cached automatically
- **Error Handling**: Always wrap calls in try-catch blocks
- **Address Validation**: Validate addresses before contract calls
- **ABI Updates**: Update ABI files when contracts are upgraded

### 2. Transaction Manager

- **Gas Estimation**: Always estimate gas before submission
- **Retry Logic**: Use built-in retry for transient failures
- **Confirmation**: Wait for confirmation before considering transaction complete
- **Account Security**: Never commit private keys to version control

### 3. General

- **Provider Connection**: Validate provider connection before operations
- **Configuration**: Use environment-specific configurations
- **Logging**: Monitor logs for transaction status and errors
- **Testing**: Test on Sepolia testnet before mainnet deployment

## Integration with Vesu Services

The Starknet Integration Layer is used by higher-level Vesu services:

```javascript
// Example: VesuService using both managers
const StarknetContractManager = require('./StarknetContractManager');
const TransactionManager = require('./TransactionManager');

class VesuService {
  constructor() {
    this.contractManager = new StarknetContractManager();
    this.txManager = new TransactionManager();
  }

  async supply(poolAddress, asset, amount, userAddress) {
    // Use contract manager to read state
    const position = await this.contractManager.callPoolMethod(
      poolAddress,
      'position',
      [asset, debtAsset, userAddress]
    );

    // Use transaction manager to submit transaction
    const result = await this.txManager.submitAndWait(
      poolAddress,
      'modify_position',
      [modifyPositionParams]
    );

    return result;
  }
}
```

## Troubleshooting

### Common Issues

**Issue: "Failed to load Pool ABI"**
- Solution: Ensure `backend/abis/pool-abi.json` exists and is valid JSON

**Issue: "Account not initialized"**
- Solution: Set `STARKNET_ACCOUNT_ADDRESS` and `STARKNET_PRIVATE_KEY` environment variables

**Issue: "Transaction confirmation timeout"**
- Solution: Increase `confirmationTimeout` in vesu.config.js or check network status

**Issue: "Invalid pool address format"**
- Solution: Ensure address starts with '0x' and is valid hex

**Issue: "Contract not found at address"**
- Solution: Verify contract is deployed on the current network (Sepolia/Mainnet)

## Future Enhancements

Planned improvements:
- [ ] Multicall support for batch operations
- [ ] Event listening and parsing
- [ ] Transaction simulation before submission
- [ ] Enhanced gas price strategies
- [ ] WebSocket support for real-time updates
- [ ] Contract upgrade detection and handling

## References

- [Starknet.js Documentation](https://www.starknetjs.com/)
- [Vesu V2 Developer Docs](https://docs.vesu.xyz/developers/)
- [Starknet Account Abstraction](https://docs.starknet.io/documentation/architecture_and_concepts/Accounts/introduction/)
- [ERC-4626 Standard](https://eips.ethereum.org/EIPS/eip-4626)

---

*Last Updated: January 26, 2026*
