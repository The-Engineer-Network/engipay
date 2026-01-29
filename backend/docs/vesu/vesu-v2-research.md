# Vesu V2 Protocol Research Summary

## Overview

Vesu V2 is a fully open and permissionless lending protocol built on Starknet. It represents the next iteration of Vesu, focusing on simplicity and security improvements over V1.

**Source:** [Vesu V2 Developer Documentation](https://docs.vesu.xyz/developers/)

## Key Architecture Features

### 1. Pool Isolation
- Each lending pool is isolated in a separate Pool contract instance
- User funds are isolated by design in separate Pool instances
- Reduces attack surface and increases confidence in the codebase

### 2. Simplified Design
- Removal of hooks and extensions from V1
- All pool state and logic consolidated into a single Pool contract
- vTokens externalized into stand-alone ERC-4626 vaults

### 3. Core Components

#### Pool Contract
- Manages all state, user funds, and interactions for a specific pool
- Handles positions with collateral_shares and nominal_debt
- Supports flexible lending pair configurations
- Curators maintain granular control over risk parameters

**Key Functions:**
- `modify_position()` - Create, modify, and close positions
- `position()` - Retrieve current position state
- `liquidate_position()` - Liquidate insolvent positions

#### Oracle Integration
- Pool fetches asset prices from external trusted Oracle
- Factory Oracle uses Pragma price feeds with additional validations
- Pool pauses withdrawals if it receives untrusted prices
- Oracle contracts are upgradeable by Vesu Security Council

#### vToken (ERC-4626)
- Stand-alone vaults following ERC-4626 standard
- Deployed by PoolFactory for each asset in a pool
- Simplified UX for depositing funds and receiving share tokens
- Uses OpenZeppelin standard implementation

#### PoolFactory
- Deploys new Pool instances through `create_pool` interface
- Initializes pools with asset and pair parameters
- Deploys respective vTokens for each asset
- Pool creation remains permissionless

### 4. Security Features
- Hypernative real-time threat detection (opt-in for curators)
- Continuous monitoring with ability to pause pools on threats
- Pool and Oracle contracts upgradeable by Security Council
- Pausing agent can pause deposits/withdrawals

## Data Structures

### AssetConfig
Contains state for a specific asset in a pool:
- `total_collateral_shares` - Total collateral in the pool
- `total_nominal_debt` - Total debt in the pool
- `reserve` - Reserve amount
- `max_utilization` - Maximum utilization percentage
- `last_updated` - Last update timestamp
- `last_rate_accumulator` - Interest rate accumulator
- `fee_rate` - Fee percentage
- `fee_shares` - Unclaimed fee shares

### Position
Represents a user's position in a lending pair:
- `collateral_shares` - User's collateral (requires conversion to assets)
- `nominal_debt` - User's debt (requires conversion to assets)

### ModifyPositionParams
Used to express position changes:
- `collateral_asset` - Address of collateral asset
- `debt_asset` - Address of debt asset
- `user` - Position owner address
- `collateral` - Amount to deposit/withdraw (Amount type)
- `debt` - Amount to borrow/repay (Amount type)

### Amount & AmountDenomination
- **Assets denomination** - Underlying asset units directly
- **Native denomination** - Vesu's internal denomination (collateral_shares or nominal_debt)
- Signed integer: positive = deposit/borrow, negative = withdraw/repay

### LiquidatePositionParams
Used for liquidation execution:
- `collateral_asset`, `debt_asset`, `user` - Position identifiers
- `debt_to_repay` - Amount of debt to repay (Assets denomination)
- `min_collateral_to_receive` - Minimum collateral to receive (Assets denomination)

## Supply and Withdraw Operations

### Using vToken (Recommended)
**Supply:**
```cairo
fn deposit(assets: u256, receiver: ContractAddress) -> u256
```
- Mints vault shares to receiver
- Returns amount of newly-minted shares

**Withdraw:**
```cairo
fn withdraw(assets: u256, receiver: ContractAddress, owner: ContractAddress) -> u256
```
- Burns shares from owner
- Sends assets to receiver

### Using Pool Contract Directly
Use `modify_position()` with:
- `collateral_asset` - Asset to supply/withdraw
- `debt_asset` - Second supported asset (implementation detail)
- `user` - Position owner
- `collateral.value > 0` - Supply assets
- `collateral.value < 0` - Withdraw assets
- `debt` - Amount reflecting 0

**Note:** If user is not the sender, delegation must be set via `modify_delegation()`

## Key Differences from V1

1. **No hooks system** - Removed entirely for simplicity
2. **Separate Pool instances** - Funds isolated by design
3. **Stand-alone vTokens** - ERC-4626 compatible, work independently
4. **Simplified state** - Single contract for all pool logic
5. **Enhanced security** - Hypernative monitoring integration

## Implementation Considerations

### For EngiPay Integration:

1. **Contract Interactions:**
   - Primary interaction through Pool's `modify_position()` function
   - vToken deposit/withdraw for simplified user experience
   - Oracle price fetching for health factor calculations

2. **Position Management:**
   - Track collateral_shares and nominal_debt
   - Convert between Native and Assets denominations
   - Monitor position solvency based on oracle prices

3. **Liquidations:**
   - Use `liquidate_position()` with LiquidatePositionParams
   - Calculate debt to repay and expected collateral
   - Monitor for positions with health factor < 1.0

4. **Security:**
   - Validate oracle prices before operations
   - Handle pool pause states gracefully
   - Implement proper delegation for multi-user scenarios

5. **vToken Integration:**
   - Use ERC-4626 standard interface
   - Track share tokens for user deposits
   - Calculate underlying asset value from shares

## References

- [Vesu V2 Developer Docs](https://docs.vesu.xyz/developers/)
- [Architecture Overview](https://docs.vesu.xyz/developers/core/architecture)
- [Pool Contract Details](https://docs.vesu.xyz/developers/core/pool)
- [Supply & Withdraw Guide](https://docs.vesu.xyz/developers/interact/supply-withdraw)
- [OpenZeppelin ERC-4626 Implementation](https://github.com/OpenZeppelin/cairo-contracts)

---

*Research completed: January 26, 2026*
*Content rephrased for compliance with licensing restrictions*


---

## Pool Contract Interface Details

### Core Functions

#### 1. modify_position()
Primary function for all position modifications (supply, borrow, repay, withdraw).

**Parameters:**
- `ModifyPositionParams` struct containing:
  - `collateral_asset: ContractAddress` - Collateral asset address
  - `debt_asset: ContractAddress` - Debt asset address
  - `user: ContractAddress` - Position owner
  - `collateral: Amount` - Collateral change (positive = deposit, negative = withdraw)
  - `debt: Amount` - Debt change (positive = borrow, negative = repay)

**Usage Patterns:**
- **Supply**: collateral.value > 0, debt.value = 0
- **Withdraw**: collateral.value < 0, debt.value = 0
- **Borrow**: collateral.value = 0, debt.value > 0
- **Repay**: collateral.value = 0, debt.value < 0

#### 2. position()
Retrieve current position state.

**Parameters:**
- `collateral_asset: ContractAddress`
- `debt_asset: ContractAddress`
- `user: ContractAddress`

**Returns:**
- `Position` struct with:
  - `collateral_shares: u256` (Native denomination)
  - `nominal_debt: u256` (Native denomination)
  - Collateral assets (Asset denomination)
  - Debt assets (Asset denomination)

#### 3. liquidate_position()
Execute liquidation of insolvent position.

**Parameters:**
- `LiquidatePositionParams` struct containing:
  - `collateral_asset: ContractAddress`
  - `debt_asset: ContractAddress`
  - `user: ContractAddress`
  - `debt_to_repay: u256` (Assets denomination)
  - `min_collateral_to_receive: u256` (Assets denomination)

#### 4. asset_config()
Fetch asset configuration and state.

**Parameters:**
- `asset: ContractAddress`

**Returns:**
- `AssetConfig` struct with all asset state

#### 5. modify_delegation()
Set delegation for position management.

**Parameters:**
- `delegatee: ContractAddress`
- `delegation: bool`

### Curator Functions

#### set_asset_parameter()
Change asset-specific parameters.

**Modifiable Parameters:**
- Total collateral shares
- Total nominal debt
- Reserve amount
- Max utilization
- Floor
- Scale
- Fee rate

#### set_interest_rate_parameter()
Modify interest rate model parameters.

#### set_pair_parameter()
Change lending pair parameters.

**Modifiable Parameters:**
- Max LTV
- Liquidation threshold
- Liquidation bonus

#### set_fee_recipient()
Update fee recipient address.

#### nominate_curator() / accept_curator()
Two-step curator role transfer.

### Pausing Functions

#### set_pausing_agent()
Assign pauser role to new account.

#### pause() / unpause()
Pause/unpause deposits and withdrawals.

---

## vToken (ERC-4626) Interface

### Standard ERC-4626 Functions

#### deposit()
Mint vault shares by depositing assets.

**Signature:**
```cairo
fn deposit(
    ref self: ComponentState<TContractState>,
    assets: u256,
    receiver: ContractAddress
) -> u256
```

**Parameters:**
- `assets: u256` - Amount of underlying tokens to deposit
- `receiver: ContractAddress` - Address to receive vault shares

**Returns:**
- `u256` - Amount of newly-minted shares

**Requirements:**
- Assets must be ≤ max deposit amount for receiver

**Emits:** `Deposit` event

#### withdraw()
Burn shares and receive underlying assets.

**Signature:**
```cairo
fn withdraw(
    ref self: ComponentState<TContractState>,
    assets: u256,
    receiver: ContractAddress,
    owner: ContractAddress
) -> u256
```

**Parameters:**
- `assets: u256` - Amount of underlying tokens to withdraw
- `receiver: ContractAddress` - Address to receive assets
- `owner: ContractAddress` - Address whose shares are burned

**Returns:**
- `u256` - Amount of shares burned

**Requirements:**
- Assets must be ≤ max withdraw amount of owner

**Emits:** `Withdraw` event

#### Additional ERC-4626 Functions

Standard functions as per [SNIP-16 (ERC-4626 for Starknet)](https://community.starknet.io/t/snip-16-erc-4626-tokenized-vaults/114045):

- `asset()` - Get underlying asset address
- `totalAssets()` - Get total managed assets
- `convertToShares(assets)` - Convert assets to shares
- `convertToAssets(shares)` - Convert shares to assets
- `maxDeposit(receiver)` - Max deposit amount
- `maxMint(receiver)` - Max mint amount
- `maxWithdraw(owner)` - Max withdraw amount
- `maxRedeem(owner)` - Max redeem amount
- `previewDeposit(assets)` - Preview deposit
- `previewMint(shares)` - Preview mint
- `previewWithdraw(assets)` - Preview withdraw
- `previewRedeem(shares)` - Preview redeem
- `mint(shares, receiver)` - Mint exact shares
- `redeem(shares, receiver, owner)` - Redeem exact shares

### vToken Characteristics

1. **1:1 Relationship**: Each vToken corresponds to one asset in one Pool
2. **Share Equivalence**: vToken shares = collateral_shares (1:1)
3. **Autonomous Operation**: No manager/owner role, fully trustless
4. **Instant Processing**: Deposits/withdraws processed atomically
5. **Interest Earning**: Automatically earns interest from underlying Pool
6. **Factory Deployment**: Created by PoolFactory for official pools

---

## Contract ABI Notes

### ABI Acquisition

The actual ABI JSON files can be obtained from:

1. **Vesu V2 GitHub Repository**: [github.com/vesuxyz/vesu-v2](https://github.com/vesuxyz/vesu-v2)
   - Pool contract ABI in compiled artifacts
   - vToken contract ABI in compiled artifacts

2. **Starknet Block Explorers**:
   - Starkscan: [starkscan.co](https://starkscan.co)
   - Voyager: [voyager.online](https://voyager.online)
   - Query deployed contract addresses to get verified ABIs

3. **PoolFactory Contract**:
   - Maintains mappings: `VToken -> Pool` and `Pool, Asset -> VToken`
   - Use to verify official vToken addresses

### ABI Structure Expectations

Based on Cairo contract patterns, expect:

**Pool Contract ABI:**
- External functions for position management
- View functions for state queries
- Events for position updates, liquidations
- Struct definitions for Position, AssetConfig, ModifyPositionParams

**vToken Contract ABI:**
- ERC-4626 standard interface functions
- ERC-20 standard functions (shares are ERC-20 tokens)
- Events: Deposit, Withdraw, Transfer, Approval

### Integration Approach

For EngiPay integration:

1. **Obtain ABIs**: Clone vesu-v2 repo or fetch from deployed contracts
2. **Use starknet.js**: Load ABIs with Contract class
3. **Type Generation**: Generate TypeScript types from ABIs
4. **Cache Contracts**: Initialize and cache contract instances
5. **Error Handling**: Parse Cairo revert reasons from transaction failures

---

## Amount Type System

### AmountDenomination Enum

```cairo
enum AmountDenomination {
    Assets,  // Underlying asset units
    Native   // Vesu internal units (collateral_shares or nominal_debt)
}
```

### Amount Struct

```cairo
struct Amount {
    denomination: AmountDenomination,
    value: i256  // Signed integer: positive = deposit/borrow, negative = withdraw/repay
}
```

### Conversion Requirements

**For Collateral:**
- Assets → Native: Divide by exchange rate
- Native → Assets: Multiply by exchange rate

**For Debt:**
- Assets → Native: Apply interest rate accumulator
- Native → Assets: Apply inverse of accumulator

### Implementation Considerations

1. **Precision**: Use high-precision arithmetic (Decimal.js recommended)
2. **Rounding**: Be aware of rounding direction (favor protocol safety)
3. **Exchange Rates**: Fetch current rates before conversions
4. **Interest Accrual**: Account for time-based debt growth

---

*Contract interface research completed: January 26, 2026*
