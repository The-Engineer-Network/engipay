# Vesu V2 Integration - Research Summary

## Overview

This document summarizes the research conducted for integrating Vesu V2 lending protocol into the EngiPay backend. All research was completed on January 26, 2026.

## Research Documents Created

### 1. Vesu V2 Protocol Research (`vesu-v2-research.md`)

**Key Findings:**
- Vesu V2 focuses on simplicity and security with isolated Pool instances
- Each pool is a separate contract managing its own state and funds
- Removed hooks/extensions from V1 for simplified architecture
- vTokens are stand-alone ERC-4626 vaults
- Pool contract has single `modify_position()` function for all operations
- Positions tracked with collateral_shares and nominal_debt (Native denomination)
- Oracle integration with Pragma for price feeds with validation
- Pool pauses if oracle returns untrusted prices

**Critical Implementation Details:**
- ModifyPositionParams struct used for all position modifications
- Amount type supports both Assets and Native denominations
- Signed integers: positive = deposit/borrow, negative = withdraw/repay
- Health factor = (risk-adjusted collateral) / debt
- Liquidation eligible when health factor < 1.0

### 2. ERC-4626 vToken Standard (`erc-4626-vtoken-standard.md`)

**Key Findings:**
- Standard API for tokenized vaults with single underlying ERC-20
- Shares represent fractional ownership of vault holdings
- Share value increases over time as vault earns yield
- Starknet adaptation via SNIP-22
- Vesu vTokens use OpenZeppelin Cairo implementation

**Critical Functions:**
- `deposit(assets, receiver)` - Mint shares for assets
- `withdraw(assets, receiver, owner)` - Burn shares for assets
- `convertToShares(assets)` / `convertToAssets(shares)` - Conversions
- Preview functions for simulating operations
- Max functions for checking limits

**Security Considerations:**
- Rounding directions favor vault over users
- Preview functions can be manipulated by on-chain conditions
- Convert functions are safer for price oracles
- Always validate slippage for EOA users

### 3. Pragma Oracle Integration (`pragma-oracle-integration.md`)

**Key Findings:**
- Enterprise-grade oracle with on-chain data submission
- Multiple aggregation methods: Median, Mean, TWAP, Volume-weighted
- Mainnet Oracle: `0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b`
- Sepolia Oracle: `0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a`

**Critical Implementation Details:**
- Asset pairs as felt252 identifiers (ETH/USD: 19514442401534788)
- PragmaPricesResponse includes price, decimals, timestamp, num_sources
- Always validate price staleness (max 5 minutes for critical ops)
- Require minimum 3 sources for basic operations
- Use TWAP for liquidations, Median for UI/display

**Validation Requirements:**
- Check `last_updated_timestamp` for staleness
- Verify `num_sources_aggregated` >= 3
- Ensure price is non-zero
- Implement caching with 30-60 second TTL

### 4. Liquidator Reference Implementation (`vesu-liquidator-reference.md`)

**Key Findings:**
- Open-source bot by Astraly Labs (Pragma team)
- Capital-neutral liquidations using Ekubo flash loans
- Three components: Indexer (Apibara), Monitoring, Executor
- Supports full and partial liquidations
- Built with Rust for performance

**Liquidation Process:**
1. Monitor positions continuously
2. Calculate health factors with Pragma prices
3. Identify positions with health factor < 1.0
4. Execute flash loan from Ekubo
5. Repay debt (discounted by liquidation factor)
6. Receive collateral
7. Swap collateral for debt asset
8. Repay flash loan + keep profit

**Profitability:**
- Profit = Collateral - Debt - Flash_Fee - Gas - Slippage
- Liquidation bonus typically 5-10%
- Minimum position size ~$100 for profitability

## Key Technical Insights

### 1. Contract Interaction Pattern

```typescript
// Primary interaction through Pool.modify_position()
const params = {
  collateral_asset: assetAddress,
  debt_asset: debtAssetAddress,
  user: userAddress,
  collateral: { denomination: 'Assets', value: amount },
  debt: { denomination: 'Assets', value: 0 }
};

await poolContract.modify_position(params);
```

### 2. Health Factor Formula

```
health_factor = (collateral_value * collateral_factor) / debt_value

Where:
- collateral_factor = risk adjustment (e.g., 0.80 for 80% LTV)
- health_factor < 1.0 = liquidatable
- health_factor >= 1.0 = healthy
```

### 3. vToken Integration

```typescript
// Simplified deposit via vToken
await vTokenContract.deposit(assetAmount, receiverAddress);

// Withdraw by burning shares
await vTokenContract.withdraw(assetAmount, receiverAddress, ownerAddress);
```

### 4. Oracle Price Fetching

```typescript
// Fetch price with validation
const response = await oracleContract.get_data_median({
  SpotEntry: assetId
});

// Validate
if (currentTime - response.last_updated_timestamp > 300) {
  throw new Error('Price stale');
}
if (response.num_sources_aggregated < 3) {
  throw new Error('Insufficient sources');
}
```

## Architecture Recommendations

### Service Layer Structure

```
VesuService (main orchestrator)
├── StarknetContractManager (contract interactions)
├── PragmaOracleService (price feeds)
├── TransactionManager (tx signing & submission)
├── PositionMonitor (background monitoring)
└── LiquidationEngine (liquidation execution)
```

### Database Models

1. **VesuPosition**: Track user positions
2. **VesuTransaction**: Record all operations
3. **VesuPool**: Cache pool configurations
4. **VesuLiquidation**: Log liquidation events

### API Endpoints

- POST /api/vesu/supply
- POST /api/vesu/borrow
- POST /api/vesu/repay
- POST /api/vesu/withdraw
- GET /api/vesu/positions
- GET /api/vesu/positions/:id/health
- POST /api/vesu/liquidations/execute

## Critical Implementation Requirements

### 1. Price Validation
- Always check staleness (< 5 min for critical ops)
- Require minimum 3 sources
- Implement caching (30-60 sec TTL)
- Use TWAP for liquidations

### 2. Health Factor Monitoring
- Background service checking every 30 seconds
- Alert users when health factor < 1.2
- Critical alerts when health factor < 1.05
- Automatic liquidation detection at < 1.0

### 3. Transaction Safety
- Validate all parameters before submission
- Implement gas estimation
- Add retry logic with exponential backoff
- Monitor transaction confirmation

### 4. Error Handling
- Handle pool pause states
- Manage oracle failures gracefully
- Implement circuit breakers
- Log all errors for monitoring

## Security Considerations

### 1. Private Key Management
- Store in environment variables or KMS
- Never log or expose in responses
- Separate keys for testnet/mainnet
- Implement key rotation

### 2. Input Validation
- Validate all user inputs
- Sanitize addresses and amounts
- Enforce min/max limits
- Check wallet balances

### 3. Rate Limiting
- Per-user limits on all endpoints
- Stricter limits on liquidations
- Use Redis for distributed limiting
- Monitor for suspicious patterns

### 4. Oracle Security
- Validate price data before use
- Handle oracle unavailability
- Implement fallback mechanisms
- Monitor for price manipulation

## Testing Strategy

### 1. Unit Tests
- Service method isolation
- Mock external dependencies
- Cover edge cases
- Target >80% coverage

### 2. Property-Based Tests
- Use fast-check framework
- Test all correctness properties from design
- Run 1000+ test cases each
- Focus on invariants

### 3. Integration Tests
- End-to-end workflows on Sepolia
- Actual contract interactions
- Transaction confirmation
- Database persistence

### 4. Performance Tests
- Load test API endpoints
- Stress test position monitoring
- Measure response times
- Validate caching

## Next Steps

1. **Phase 2: Core Infrastructure**
   - Implement StarknetContractManager
   - Build TransactionManager
   - Create PragmaOracleService

2. **Phase 3: Core Operations**
   - Implement supply/borrow/repay/withdraw services
   - Add position tracking
   - Build health factor calculations

3. **Phase 4: Position Management**
   - Create PositionMonitor background service
   - Implement alert system
   - Build liquidation engine

4. **Phase 5: API Layer**
   - Create RESTful endpoints
   - Add authentication/authorization
   - Implement rate limiting
   - Write API documentation

## References

All research documents are located in `backend/docs/`:
- `vesu-v2-research.md`
- `erc-4626-vtoken-standard.md`
- `pragma-oracle-integration.md`
- `vesu-liquidator-reference.md`

External resources:
- [Vesu V2 Documentation](https://docs.vesu.xyz/developers/)
- [Pragma Documentation](https://docs.pragma.build/starknet/introduction)
- [EIP-4626 Specification](https://eip.info/eip/4626)
- [vesu-v2-liquidator GitHub](https://github.com/astraly-labs/vesu-v2-liquidator)

---

*Research completed: January 26, 2026*
*Ready to proceed with implementation phases*
