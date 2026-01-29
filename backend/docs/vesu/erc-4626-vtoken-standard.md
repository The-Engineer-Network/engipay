# ERC-4626 Tokenized Vault Standard

## Overview

ERC-4626 is a standard API for tokenized vaults representing shares of a single underlying ERC-20 token. It provides standardized functionality for depositing and withdrawing tokens and reading balances.

**Purpose:** Unify technical parameters of yield-bearing vaults to reduce integration effort and create consistent implementation patterns.

**Source:** [EIP-4626 Specification](https://eip.info/eip/4626)

## Core Concepts

### 1. Shares vs Assets

- **Assets**: The underlying ERC-20 tokens deposited into the vault
- **Shares**: ERC-20 tokens representing ownership claims on vault holdings
- **Exchange Rate**: Ratio between shares and underlying assets (changes over time with yield)

### 2. Vault Characteristics

- Vaults MUST implement ERC-20 for share tokens
- Vaults MUST implement ERC-20 metadata extensions (name, symbol)
- Vaults MAY implement ERC-2612 for gasless approvals
- Share tokens represent fractional ownership of vault holdings

### 3. Yield Accrual

- Share value increases over time as vault earns yield
- Users receive same number of shares, but each share is worth more assets
- Example: Deposit 100 assets → receive 100 shares. Later, 100 shares → withdraw 105 assets

## Standard Functions

### Asset Information

#### asset()
Returns the address of the underlying token.

**Requirements:**
- MUST be an ERC-20 token contract
- MUST NOT revert

#### totalAssets()
Total amount of underlying asset managed by vault.

**Requirements:**
- SHOULD include compounding yield
- MUST include any fees charged
- MUST NOT revert


### Conversion Functions

#### convertToShares(assets)
Calculate shares for given asset amount (ideal scenario).

**Requirements:**
- MUST NOT include fees
- MUST NOT vary by caller
- MUST NOT reflect slippage
- MUST round down towards 0
- Reflects "average-user" price-per-share

#### convertToAssets(shares)
Calculate assets for given share amount (ideal scenario).

**Requirements:**
- MUST NOT include fees
- MUST NOT vary by caller
- MUST NOT reflect slippage
- MUST round down towards 0
- Reflects "average-user" price-per-share

### Deposit Operations

#### maxDeposit(receiver)
Maximum assets that can be deposited for receiver.

**Requirements:**
- MUST return maximum without causing revert
- MUST factor in global and user-specific limits
- MUST return 2^256 - 1 if no limit
- MUST return 0 if deposits disabled
- MUST NOT revert

#### previewDeposit(assets)
Simulate deposit effects at current block.

**Requirements:**
- MUST return close to exact shares that would be minted
- MUST NOT account for deposit limits
- MUST be inclusive of deposit fees
- MUST NOT revert due to vault-specific limits

#### deposit(assets, receiver)
Mint shares by depositing exact asset amount.

**Requirements:**
- MUST emit Deposit event
- MUST support ERC-20 approve/transferFrom flow
- MUST revert if all assets cannot be deposited
- Requires pre-approval of vault with underlying asset

**Returns:** Amount of shares minted


### Mint Operations

#### maxMint(receiver)
Maximum shares that can be minted for receiver.

**Requirements:**
- MUST return maximum without causing revert
- MUST factor in global and user-specific limits
- MUST return 2^256 - 1 if no limit
- MUST return 0 if mints disabled
- MUST NOT revert

#### previewMint(shares)
Simulate mint effects at current block.

**Requirements:**
- MUST return close to exact assets that would be deposited
- MUST NOT account for mint limits
- MUST be inclusive of deposit fees
- MUST NOT revert due to vault-specific limits

#### mint(shares, receiver)
Mint exact shares by depositing assets.

**Requirements:**
- MUST emit Deposit event
- MUST support ERC-20 approve/transferFrom flow
- MUST revert if all shares cannot be minted
- Requires pre-approval of vault with underlying asset

**Returns:** Amount of assets deposited

### Withdrawal Operations

#### maxWithdraw(owner)
Maximum assets that can be withdrawn from owner balance.

**Requirements:**
- MUST return maximum without causing revert
- MUST factor in global and user-specific limits
- MUST return 0 if withdrawals disabled
- MUST NOT revert

#### previewWithdraw(assets)
Simulate withdrawal effects at current block.

**Requirements:**
- MUST return close to exact shares that would be burned
- MUST NOT account for withdrawal limits
- MUST be inclusive of withdrawal fees
- MUST NOT revert due to vault-specific limits

#### withdraw(assets, receiver, owner)
Burn shares and send exact asset amount.

**Requirements:**
- MUST emit Withdraw event
- MUST support flow where owner is msg.sender
- MUST support flow where msg.sender has approval
- SHOULD check msg.sender can spend owner funds
- MUST revert if all assets cannot be withdrawn

**Returns:** Amount of shares burned


### Redeem Operations

#### maxRedeem(owner)
Maximum shares that can be redeemed from owner balance.

**Requirements:**
- MUST return maximum without causing revert
- MUST factor in global and user-specific limits
- MUST return 0 if redemption disabled
- MUST NOT revert

#### previewRedeem(shares)
Simulate redemption effects at current block.

**Requirements:**
- MUST return close to exact assets that would be withdrawn
- MUST NOT account for redemption limits
- MUST be inclusive of withdrawal fees
- MUST NOT revert due to vault-specific limits

#### redeem(shares, receiver, owner)
Burn exact shares and send assets.

**Requirements:**
- MUST emit Withdraw event
- MUST support flow where owner is msg.sender
- MUST support flow where msg.sender has approval
- SHOULD check msg.sender can spend owner funds
- MUST revert if all shares cannot be redeemed

**Returns:** Amount of assets withdrawn

## Events

### Deposit Event
```solidity
event Deposit(
    address indexed sender,
    address indexed owner,
    uint256 assets,
    uint256 shares
)
```

Emitted when tokens are deposited via mint() or deposit().

### Withdraw Event
```solidity
event Withdraw(
    address indexed sender,
    address indexed receiver,
    address indexed owner,
    uint256 assets,
    uint256 shares
)
```

Emitted when shares are withdrawn via redeem() or withdraw().

## Rounding Directions

Critical for security - favor vault over users:

- **deposit()**: Round DOWN shares minted (user gets fewer shares)
- **mint()**: Round UP assets taken (user pays more assets)
- **withdraw()**: Round UP shares burned (user loses more shares)
- **redeem()**: Round DOWN assets sent (user receives fewer assets)
- **convertTo functions**: Always round DOWN

## Starknet Adaptation (SNIP-22)

Starknet's SNIP-22 adapts ERC-4626 for Cairo:

- Follows same conceptual model
- Uses Cairo-specific types (u256, ContractAddress)
- Implements as Cairo components
- Compatible with SNIP-2 (ERC-20 equivalent)
- Used by Vesu V2 vTokens


## Security Considerations

### 1. Preview vs Convert Functions

- **convert functions**: Estimates for display, can be inexact, robust as price oracles
- **preview functions**: As close to exact as possible, manipulable by on-chain conditions
- **Key difference**: previewRedeem ≠ previewMint for same share amount (fees, slippage)

### 2. Malicious Implementations

- Fully permissionless vaults could conform to interface but not specification
- Always review implementation before integrating
- Verify vault behavior matches expected semantics

### 3. Slippage Protection

- EOA users should use additional slippage parameters
- No built-in revert mechanism if exact output not achieved
- Consider wrapper contracts for better UX

### 4. Price Oracle Usage

- totalAssets(), convertTo functions are estimates
- Not always safe as price oracles
- Can be manipulated by altering on-chain conditions
- Use time-weighted averages for robust pricing

### 5. Fee Awareness

- Deposit/withdrawal fees can cause significant differences
- previewDeposit vs previewMint can vary greatly
- Always use most relevant preview function for use case
- Never assume preview functions are interchangeable

## Vesu V2 vToken Implementation

### Key Features

1. **OpenZeppelin Standard**: Uses OpenZeppelin Cairo implementation
2. **1:1 Share Mapping**: vToken shares = Pool collateral_shares
3. **Single Asset/Pool**: Each vToken corresponds to one asset in one Pool
4. **Autonomous**: No manager/owner role, fully trustless
5. **Atomic Processing**: Deposits/withdraws processed instantly
6. **Auto-Compounding**: Automatically earns interest from Pool

### Integration Pattern

```typescript
// Example: Deposit assets to vToken
const vTokenContract = new Contract(vTokenABI, vTokenAddress, provider);

// 1. Approve vToken to spend assets
await assetContract.approve(vTokenAddress, depositAmount);

// 2. Deposit assets, receive shares
const shares = await vTokenContract.deposit(depositAmount, userAddress);

// 3. Later: Withdraw assets by burning shares
const assets = await vTokenContract.withdraw(withdrawAmount, userAddress, userAddress);
```

### Verification

Use PoolFactory to verify official vTokens:
- Mapping: `VToken -> Pool`
- Mapping: `Pool, Asset -> VToken`

## Implementation Checklist

For EngiPay Vesu integration:

- [ ] Load vToken ABIs from Vesu V2 contracts
- [ ] Implement deposit flow with approval
- [ ] Implement withdraw flow with share burning
- [ ] Track user share balances
- [ ] Calculate underlying asset value from shares
- [ ] Handle exchange rate changes over time
- [ ] Implement preview functions for UX
- [ ] Add slippage protection for users
- [ ] Verify vToken addresses via PoolFactory
- [ ] Handle vault pause states
- [ ] Test with small amounts first
- [ ] Monitor for fee changes

## References

- [EIP-4626 Specification](https://eip.info/eip/4626)
- [SNIP-22 Starknet Proposal](https://community.starknet.io/t/snip-22-tokenized-vaults/114457)
- [OpenZeppelin Cairo Contracts](https://github.com/OpenZeppelin/cairo-contracts)
- [Vesu vToken Documentation](https://docs.vesu.xyz/developers/core/vtoken)

---

*Content rephrased for compliance with licensing restrictions*
