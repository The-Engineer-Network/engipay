# Vesu V2 Liquidator Reference Implementation

## Overview

The Vesu V2 liquidator is an open-source bot developed by Astraly Labs (Pragma team) in collaboration with Vesu. It provides a reference implementation for monitoring and executing liquidations on the Vesu lending protocol.

**Repository:** [astraly-labs/vesu-v2-liquidator](https://github.com/astraly-labs/vesu-v2-liquidator)

**Key Features:**
- Fully open-source and permissionless
- Capital-neutral liquidations using flash loans
- Continuous position monitoring
- Support for full and partial liquidations
- Built with Rust for performance

**Source:** [Pragma Blog Announcement](https://blog.pragma.build/announcing-the-open-source-liquidation-bot-for-vesu/)

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Liquidation Bot                          │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │   Indexer    │  │  Monitoring  │  │   Liquidation   │  │
│  │   Service    │─>│   Service    │─>│    Executor     │  │
│  │  (Apibara)   │  │              │  │                 │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│         │                  │                   │           │
└─────────┼──────────────────┼───────────────────┼───────────┘
          │                  │                   │
          ▼                  ▼                   ▼
    ┌──────────┐      ┌──────────┐       ┌──────────┐
    │  Vesu    │      │  Pragma  │       │  Ekubo   │
    │  Pools   │      │  Oracle  │       │  Flash   │
    │          │      │          │       │  Loans   │
    └──────────┘      └──────────┘       └──────────┘
```

### Component Details

#### 1. Indexer Service (Apibara)
- Retrieves all open positions from protocol creation
- Indexes positions from Vesu contract events
- Sends position data to monitoring service
- Stores positions locally for fast access

#### 2. Monitoring Service
- Stores positions in local database
- Fetches oracle prices via Pragma API
- Calculates health factors for all positions
- Identifies liquidatable positions (health factor < 1.0)
- Determines liquidation amounts (full or partial)

#### 3. Liquidation Executor
- Executes liquidations using flash loans
- Interacts with Liquidate periphery contract
- Handles asset swaps via DEX
- Manages profit extraction


## Liquidation Process

### Full Liquidation Flow

1. **Position Monitoring**
   - Bot continuously monitors all open positions
   - Fetches current prices from Pragma Oracle
   - Calculates health factor: `(risk-adjusted collateral) / liabilities`

2. **Liquidation Detection**
   - Identifies positions with health factor < 1.0
   - Liabilities exceed risk-adjusted collateral
   - Position becomes eligible for liquidation

3. **Flash Loan Execution**
   - Borrow debt asset from Ekubo via flash loan
   - No upfront capital required (capital-neutral)

4. **Debt Repayment**
   - Repay position's debt discounted by liquidation factor
   - Liquidation factor provides profit incentive

5. **Collateral Receipt**
   - Receive position's collateral in exchange
   - Collateral value > debt repaid (due to discount)

6. **Asset Swap**
   - Swap collateral for debt asset via DEX
   - Convert back to original borrowed asset

7. **Flash Loan Repayment**
   - Repay Ekubo flash loan
   - Keep remaining debt asset as profit

### Partial Liquidation Flow

For protocols/pools supporting partial liquidations:

1. **Calculate Liquidation Amount**
   - Determine amount needed to restore health factor to 1.001
   - Use Vesu-specific liquidation equation

2. **Health Factor Restoration**
   - Target: Restore health factor to just above 1.0
   - Minimize liquidation impact on user

3. **Liquidation Equation**
   ```
   Account for liquidation effect on both sides:
   - Collateral reduction
   - Debt reduction
   
   Solve for L (amount to liquidate):
   L = (debt - collateral) / (liquidation_factor - 1)
   ```

4. **Execute Partial Liquidation**
   - Same flash loan process
   - Only liquidate calculated amount
   - Position remains open with improved health

## Health Factor Calculation

### Formula

```
health_factor = (risk_adjusted_collateral) / liabilities
```

Where:
- `risk_adjusted_collateral = collateral_value * collateral_factor`
- `liabilities = debt_value`

### Liquidation Thresholds

- **health_factor >= 1.0**: Position is healthy
- **health_factor < 1.0**: Position is liquidatable
- **health_factor = 1.001**: Target for partial liquidations

### Example

```
Collateral: 1.5 ETH @ $2,500 = $3,750
Collateral Factor: 0.80
Risk-Adjusted Collateral: $3,750 * 0.80 = $3,000

Debt: 2,100 USDC = $2,100

Health Factor: $3,000 / $2,100 = 1.43 (healthy)

If ETH drops to $1,800:
Collateral Value: 1.5 * $1,800 = $2,700
Risk-Adjusted: $2,700 * 0.80 = $2,160
Health Factor: $2,160 / $2,100 = 1.03 (at risk)

If ETH drops to $1,600:
Collateral Value: 1.5 * $1,600 = $2,400
Risk-Adjusted: $2,400 * 0.80 = $1,920
Health Factor: $1,920 / $2,100 = 0.91 (liquidatable!)
```

## Flash Loan Integration

### Ekubo Flash Loans

Ekubo is a DEX on Starknet providing flash loan functionality:

- **Zero upfront capital**: Borrow assets within single transaction
- **Atomic execution**: All steps must succeed or revert
- **Fee structure**: Small fee on borrowed amount
- **Instant repayment**: Must repay in same transaction

### Flash Loan Pattern

```rust
// Pseudocode for flash loan liquidation
fn execute_liquidation(position: Position) -> Result<Profit> {
    // 1. Calculate amounts
    let debt_to_repay = position.debt;
    let expected_collateral = calculate_collateral_received(debt_to_repay);
    
    // 2. Initiate flash loan
    let borrowed = ekubo.flash_loan(debt_asset, debt_to_repay);
    
    // 3. Liquidate position
    let collateral = vesu.liquidate_position(
        position.user,
        position.collateral_asset,
        position.debt_asset,
        debt_to_repay
    );
    
    // 4. Swap collateral for debt asset
    let debt_asset_received = dex.swap(
        collateral,
        position.collateral_asset,
        position.debt_asset
    );
    
    // 5. Repay flash loan
    ekubo.repay_flash_loan(borrowed + fee);
    
    // 6. Keep profit
    let profit = debt_asset_received - borrowed - fee;
    return Ok(profit);
}
```

## Liquidation Periphery Contract

### Purpose

Specialized contract for executing liquidations:

- Handles flash loan callbacks
- Manages multi-step liquidation process
- Ensures atomic execution
- Optimizes gas usage
- Currently under audit

### Key Functions

1. **execute_liquidation()**: Main entry point
2. **flash_loan_callback()**: Handles Ekubo callback
3. **swap_assets()**: DEX integration for swaps
4. **calculate_profit()**: Profit calculation

## Pragma API Integration

### Off-Chain Price Fetching

The bot uses Pragma API (not on-chain oracle) for monitoring:

- **Pragma API**: Indexing service for off-chain price access
- **Faster**: No on-chain calls for monitoring
- **Cost-effective**: No gas fees for price checks
- **Real-time**: Continuous price updates

### On-Chain vs Off-Chain

- **Monitoring**: Uses Pragma API (off-chain)
- **Liquidation**: Uses Pragma Oracle (on-chain)
- **Verification**: On-chain prices validate liquidation

## Implementation Considerations

### For EngiPay Integration

#### 1. Position Indexing

```typescript
class PositionIndexer {
  async indexPositions(): Promise<Position[]> {
    // Use Apibara or similar indexer
    // Subscribe to Vesu contract events
    // Track: Deposit, Borrow, Repay, Withdraw, Liquidate
    
    const events = await this.indexer.getEvents({
      contract: vesuPoolAddress,
      events: ['PositionModified', 'PositionLiquidated']
    });
    
    return this.parsePositions(events);
  }
}
```

#### 2. Health Factor Monitoring

```typescript
class HealthMonitor {
  async monitorPositions(positions: Position[]): Promise<LiquidatablePosition[]> {
    const liquidatable = [];
    
    for (const position of positions) {
      // Fetch prices
      const collateralPrice = await this.pragmaAPI.getPrice(position.collateralAsset);
      const debtPrice = await this.pragmaAPI.getPrice(position.debtAsset);
      
      // Calculate health factor
      const healthFactor = this.calculateHealthFactor(
        position,
        collateralPrice,
        debtPrice
      );
      
      // Check if liquidatable
      if (healthFactor < 1.0) {
        liquidatable.push({
          position,
          healthFactor,
          profit: this.estimateProfit(position, collateralPrice, debtPrice)
        });
      }
    }
    
    return liquidatable;
  }
}
```

#### 3. Liquidation Execution

```typescript
class LiquidationExecutor {
  async executeLiquidation(position: LiquidatablePosition): Promise<TxHash> {
    // Calculate amounts
    const debtToRepay = position.debt;
    const minCollateral = this.calculateMinCollateral(debtToRepay);
    
    // Execute via periphery contract
    const tx = await this.peripheryContract.execute_liquidation({
      collateral_asset: position.collateralAsset,
      debt_asset: position.debtAsset,
      user: position.user,
      debt_to_repay: debtToRepay,
      min_collateral_to_receive: minCollateral
    });
    
    return tx.transaction_hash;
  }
}
```

## Profitability Analysis

### Profit Sources

1. **Liquidation Bonus**: Discount on debt repayment (e.g., 5-10%)
2. **Collateral Premium**: Receive more collateral than debt paid
3. **Price Arbitrage**: Potential price differences during swap

### Profit Calculation

```
Profit = Collateral_Received - Debt_Repaid - Flash_Loan_Fee - Gas_Costs - Slippage
```

### Break-Even Analysis

Minimum position size for profitability:

```
Min_Position_Size = (Flash_Loan_Fee + Gas_Costs) / Liquidation_Bonus_Rate
```

Example:
- Flash loan fee: 0.05%
- Gas costs: $5
- Liquidation bonus: 5%
- Min position: ~$100 debt

## Best Practices

### 1. Monitoring Frequency
- Check positions every 10-30 seconds
- Increase frequency during high volatility
- Use websockets for real-time price updates

### 2. Gas Optimization
- Batch liquidations when possible
- Use optimal gas price strategies
- Consider MEV protection

### 3. Risk Management
- Set maximum liquidation size
- Implement slippage protection
- Monitor flash loan availability
- Track DEX liquidity

### 4. Error Handling
- Retry failed liquidations
- Handle race conditions (position already liquidated)
- Log all attempts for analysis
- Alert on repeated failures

### 5. Profit Thresholds
- Set minimum profit threshold
- Account for gas costs
- Consider opportunity cost
- Monitor competition

## Security Considerations

### 1. Flash Loan Risks
- Ensure atomic execution
- Validate all steps succeed
- Handle callback security
- Protect against reentrancy

### 2. Price Manipulation
- Use multiple price sources
- Validate on-chain prices
- Check for price staleness
- Monitor for oracle attacks

### 3. Front-Running
- Use private mempools if available
- Implement MEV protection
- Consider transaction timing
- Monitor for sandwich attacks

### 4. Smart Contract Risks
- Audit periphery contract
- Test extensively on testnet
- Use battle-tested flash loan providers
- Implement emergency stops

## Testing Strategy

### 1. Unit Tests
- Health factor calculations
- Profit estimations
- Amount calculations
- Price validations

### 2. Integration Tests
- Full liquidation flow on testnet
- Flash loan integration
- DEX swap execution
- Error scenarios

### 3. Simulation
- Historical data replay
- Stress testing with volatile prices
- Race condition scenarios
- Gas cost analysis

## Deployment Checklist

- [ ] Clone vesu-v2-liquidator repository
- [ ] Review Rust implementation
- [ ] Set up Apibara indexer
- [ ] Configure Pragma API access
- [ ] Deploy periphery contract (after audit)
- [ ] Test on Sepolia testnet
- [ ] Monitor test liquidations
- [ ] Analyze profitability
- [ ] Set up monitoring/alerts
- [ ] Deploy to mainnet with limits
- [ ] Gradually increase limits
- [ ] Monitor performance and profits

## References

- [vesu-v2-liquidator GitHub](https://github.com/astraly-labs/vesu-v2-liquidator)
- [Pragma Blog Announcement](https://blog.pragma.build/announcing-the-open-source-liquidation-bot-for-vesu/)
- [Vesu Liquidation Docs](https://docs.vesu.xyz/developers/liquidation-bot)
- [Vesu Liquidate Function](https://docs.vesu.xyz/developers/interact/liquidate)

---

*Liquidator research completed: January 26, 2026*
*Content rephrased for compliance with licensing restrictions*
