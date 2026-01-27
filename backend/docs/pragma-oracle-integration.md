# Pragma Oracle Integration Guide

## Overview

Pragma is an enterprise-grade oracle for Starknet providing transparent, verifiable, and flexible data feeds built natively for the network.

**Key Features:**
- On-chain data submission directly to zk-rollup
- Complete transparency - all publisher data visible
- Flexible aggregation methods (median, TWAP, volume-weighted)
- High-quality data from premier market makers and exchanges

**Source:** [Pragma Documentation](https://docs.pragma.build/starknet/introduction)

## Architecture

### Data Flow

1. **Data Sources**: Premier market makers and exchanges
2. **Publishers**: Sign and timestamp data, submit to Starknet
3. **On-Chain Aggregation**: Transparent, verifiable price calculation
4. **Price Feeds**: Multiple aggregation strategies available

### Contract Structure

Pragma V1 consists of three smart contracts:

1. **Publisher Registry**: Manages authorized data publishers
2. **Oracle Contract**: Main contract for price feed queries
3. **Summary Stats**: Provides computational feeds (TWAP, volatility, etc.)

### Aggregation Mechanism

- Multiple publishers submit prices from various sources
- Initial on-chain aggregation based on median of prices
- Median becomes established price for that source
- Users can choose aggregation method for final price
- Enhances security by incorporating broad data range

## Deployed Contracts

### Mainnet
- **Oracle**: `0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b`
- **Publisher Registry**: `0x24a55b928496ef83468fdb9a5430fe031ac386b8f62f5c2eb7dd20ef7237415`

### Sepolia Testnet
- **Oracle**: `0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a`
- **Publisher Registry**: `0x1b08e27ab436cd491631156da5f3aa7ff04aee1e6ca925eb2ca84397c22b74d`


## Data Types

### DataType Enum

```cairo
enum DataType {
    SpotEntry: felt252,           // Spot price for asset pair
    FutureEntry: (felt252, u64),  // Future price with expiration
    GenericEntry: felt252         // Generic data entry
}
```

### PragmaPricesResponse Struct

```cairo
struct PragmaPricesResponse {
    price: u128,                           // Price value
    decimals: u32,                         // Decimal places
    last_updated_timestamp: u64,           // Last update time
    num_sources_aggregated: u32,           // Number of sources used
    expiration_timestamp: Option<u64>      // Expiration (for futures)
}
```

### AggregationMode Enum

```cairo
enum AggregationMode {
    Median: (),           // Middle value of all prices
    Mean: (),             // Average of all prices
    ConversionRate,       // Specialized conversion rate
    Error                 // Error state
}
```

## Asset Identifiers

Asset pairs are represented as felt252 values:

- **ETH/USD**: `19514442401534788`
- **BTC/USD**: `18669995996566340`
- **STRK/USD**: Convert string to felt252

Conversion: Use felt252 conversion utilities to convert pair strings to identifiers.

## Core Functions

### get_data_median()

Retrieve median price for an asset.

**Signature:**
```cairo
fn get_data_median(data_type: DataType) -> PragmaPricesResponse
```

**Parameters:**
- `data_type`: DataType enum specifying asset and type

**Returns:**
- `PragmaPricesResponse` with price and metadata

**Example:**
```cairo
let output = oracle_dispatcher.get_data_median(
    DataType::SpotEntry(ETH_USD)
);
let price = output.price;
```

### get_data()

Retrieve price with specific aggregation mode.

**Signature:**
```cairo
fn get_data(
    data_type: DataType,
    aggregation_mode: AggregationMode
) -> PragmaPricesResponse
```

**Parameters:**
- `data_type`: Asset and type specification
- `aggregation_mode`: How to aggregate source data

**Example:**
```cairo
let output = oracle_dispatcher.get_data(
    DataType::SpotEntry(BTC_USD),
    AggregationMode::Mean()
);
```


### get_data_with_sources()

Retrieve price filtered by specific sources.

**Signature:**
```cairo
fn get_data_with_sources(
    data_type: DataType,
    aggregation_mode: AggregationMode,
    sources: Span<felt252>
) -> PragmaPricesResponse
```

**Parameters:**
- `data_type`: Asset specification
- `aggregation_mode`: Aggregation method
- `sources`: Array of source identifiers to include

**Use Case:** Filter to trusted sources only

### Conversion Rate Functions

Specialized functions for currency conversion:

```cairo
fn get_conversion_rate(
    base_currency: felt252,
    quote_currency: felt252
) -> PragmaPricesResponse
```

Automatically calculates conversion rate between two currencies.

## Aggregation Strategies

### 1. Median (Default)
- **Use Case**: General price queries, UI display
- **Characteristics**: Robust to outliers, current price
- **Best For**: Most use cases

### 2. Mean (Average)
- **Use Case**: When all sources equally weighted
- **Characteristics**: Sensitive to outliers
- **Best For**: High-confidence source sets

### 3. TWAP (Time-Weighted Average Price)
- **Use Case**: Liquidation logic, risk management
- **Characteristics**: Lagging indicator, more stable
- **Best For**: Critical financial operations
- **Access**: Via Summary Stats contract

### 4. Volume-Weighted
- **Use Case**: Large trades, market depth analysis
- **Characteristics**: Weighted by trading volume
- **Best For**: Institutional operations

## Integration Pattern

### Cairo Contract Integration

```cairo
use pragma_lib::abi::{IPragmaABIDispatcher, IPragmaABIDispatcherTrait};
use pragma_lib::types::{DataType, AggregationMode, PragmaPricesResponse};

#[storage]
struct Storage {
    pragma_contract: ContractAddress,
}

#[constructor]
fn constructor(ref self: ContractState, pragma_address: ContractAddress) {
    self.pragma_contract.write(pragma_address);
}

fn get_asset_price(self: @ContractState, asset_id: felt252) -> u128 {
    let oracle_dispatcher = IPragmaABIDispatcher {
        contract_address: self.pragma_contract.read()
    };
    
    let output: PragmaPricesResponse = oracle_dispatcher
        .get_data_median(DataType::SpotEntry(asset_id));
    
    return output.price;
}
```

### Backend Integration (starknet.js)

```typescript
import { Contract, Provider } from 'starknet';

const provider = new Provider({ sequencer: { network: 'mainnet-alpha' } });
const oracleAddress = '0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b';

// Load Oracle ABI
const oracleContract = new Contract(oracleABI, oracleAddress, provider);

// Fetch ETH/USD price
const ETH_USD = '19514442401534788';
const response = await oracleContract.get_data_median({
  SpotEntry: ETH_USD
});

const price = response.price;
const decimals = response.decimals;
const actualPrice = price / Math.pow(10, decimals);
```


## Price Validation

### Staleness Check

Always validate price freshness:

```typescript
function isPriceStale(lastUpdated: number, maxAge: number = 300): boolean {
  const currentTime = Math.floor(Date.now() / 1000);
  return (currentTime - lastUpdated) > maxAge;
}

// Usage
const response = await oracleContract.get_data_median({SpotEntry: ETH_USD});
if (isPriceStale(response.last_updated_timestamp)) {
  throw new Error('Price data is stale');
}
```

### Source Count Validation

Ensure sufficient data sources:

```typescript
function hasMinimumSources(numSources: number, minRequired: number = 3): boolean {
  return numSources >= minRequired;
}

// Usage
if (!hasMinimumSources(response.num_sources_aggregated)) {
  throw new Error('Insufficient price sources');
}
```

### Price Sanity Checks

Implement bounds checking:

```typescript
function isPriceReasonable(
  price: number,
  lastPrice: number,
  maxDeviation: number = 0.1
): boolean {
  const deviation = Math.abs(price - lastPrice) / lastPrice;
  return deviation <= maxDeviation;
}
```

## Vesu V2 Integration

### Oracle Adapter Pattern

Vesu V2 uses an Oracle contract as adapter:

1. **Pool queries Oracle** for asset prices
2. **Oracle fetches** from Pragma with validation
3. **Oracle validates** price criteria:
   - Number of sources used
   - Price staleness
   - Non-zero price
4. **Oracle returns** price with validity flag
5. **Pool pauses** if price invalid

### Validation Criteria

Based on Pragma provider feeds:

- **Minimum Sources**: At least 3 publishers
- **Maximum Age**: Price < 5 minutes old
- **Non-Zero**: Price must be positive
- **Validity Flag**: Boolean indicating trust

### Implementation for EngiPay

```typescript
class PragmaOracleService {
  private oracleContract: Contract;
  private priceCache: Map<string, CachedPrice>;
  private cacheTimeout: number = 60000; // 1 minute
  
  async getPrice(asset: string): Promise<PriceData> {
    // Check cache first
    const cached = this.getCachedPrice(asset);
    if (cached && !this.isCacheExpired(cached)) {
      return cached.data;
    }
    
    // Fetch from Pragma
    const response = await this.oracleContract.get_data_median({
      SpotEntry: this.assetToFelt252(asset)
    });
    
    // Validate
    this.validatePrice(response);
    
    // Cache and return
    const priceData = this.parseResponse(response);
    this.setCachedPrice(asset, priceData);
    return priceData;
  }
  
  private validatePrice(response: PragmaPricesResponse): void {
    // Check staleness
    if (this.isPriceStale(response.last_updated_timestamp, 300)) {
      throw new Error('Price is stale');
    }
    
    // Check source count
    if (response.num_sources_aggregated < 3) {
      throw new Error('Insufficient sources');
    }
    
    // Check non-zero
    if (response.price === 0) {
      throw new Error('Invalid zero price');
    }
  }
}
```

## Error Handling

### Common Errors

1. **Stale Price**: `last_updated_timestamp` too old
2. **Insufficient Sources**: `num_sources_aggregated` too low
3. **Zero Price**: Invalid price value
4. **Network Issues**: RPC connection failures
5. **Invalid Asset**: Asset not supported

### Fallback Strategies

```typescript
async getPriceWithFallback(asset: string): Promise<PriceData> {
  try {
    // Try median first
    return await this.getPriceMedian(asset);
  } catch (error) {
    console.warn('Median failed, trying mean:', error);
    try {
      // Fallback to mean
      return await this.getPriceMean(asset);
    } catch (error2) {
      console.error('All price feeds failed:', error2);
      // Use cached price if available
      const cached = this.getCachedPrice(asset);
      if (cached) {
        console.warn('Using cached price');
        return cached.data;
      }
      throw new Error('Unable to fetch price from any source');
    }
  }
}
```

## Best Practices

### 1. Caching Strategy
- Cache prices for 30-60 seconds
- Reduce RPC calls and improve performance
- Always validate cache freshness

### 2. Staleness Thresholds
- **UI Display**: 5 minutes acceptable
- **Trading Operations**: 1 minute maximum
- **Liquidations**: 30 seconds maximum

### 3. Source Requirements
- **Minimum**: 3 sources for basic operations
- **Recommended**: 5+ sources for critical operations
- **Liquidations**: 7+ sources preferred

### 4. Aggregation Selection
- **UI/Display**: Median
- **Liquidations**: TWAP (via Summary Stats)
- **Risk Calculations**: TWAP or Median
- **Large Trades**: Volume-weighted

### 5. Error Recovery
- Implement retry logic with exponential backoff
- Use cached prices as last resort
- Log all oracle failures for monitoring
- Alert on repeated failures

## Computational Feeds

### Yield Curve Oracle
- On-chain, verifiable yield curve
- Uses Pragma's verified data blocks
- Access via Summary Stats contract

### Volatility Feed
- Realized and implied volatility
- Derived from raw market data
- Used for risk management

### TWAP (Time-Weighted Average Price)
- More stable, lagging indicator
- Better for liquidation logic
- Access via Summary Stats contract

## Security Considerations

### 1. Price Manipulation
- Median aggregation resists outliers
- Multiple sources reduce manipulation risk
- On-chain transparency enables verification

### 2. Oracle Failures
- Always handle oracle unavailability
- Implement circuit breakers
- Pause operations if prices invalid

### 3. Timestamp Validation
- Always check `last_updated_timestamp`
- Reject stale prices
- Use block timestamp for comparisons

### 4. Decimal Handling
- Always use `decimals` field
- Avoid precision loss in calculations
- Use high-precision libraries (Decimal.js)

## Integration Checklist

For EngiPay Vesu integration:

- [ ] Add pragma_lib dependency to project
- [ ] Store Oracle contract addresses (mainnet + testnet)
- [ ] Implement PragmaOracleService class
- [ ] Add price caching with TTL
- [ ] Implement staleness validation
- [ ] Add source count validation
- [ ] Implement fallback mechanisms
- [ ] Add error handling and retries
- [ ] Create asset ID mapping (string → felt252)
- [ ] Test with Sepolia testnet first
- [ ] Monitor oracle call frequency
- [ ] Set up alerts for oracle failures
- [ ] Document supported asset pairs

## References

- [Pragma Documentation](https://docs.pragma.build/starknet/introduction)
- [Quickstart Guide](https://docs.pragma.build/starknet/quickstart)
- [Consuming Data](https://docs.pragma.build/starknet/development)
- [Architecture](https://docs.pragma.build/starknet/architecture)
- [Supported Assets](https://docs.pragma.build/starknet/assets)

---

*Pragma Oracle research completed: January 26, 2026*
*Content rephrased for compliance with licensing restrictions*
