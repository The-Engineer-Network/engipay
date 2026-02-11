# 🔐 EngiPay Smart Contracts Guide

**Version:** 1.0.0  
**Last Updated:** February 11, 2026  
**Network:** StarkNet

---

## 📋 TABLE OF CONTENTS

1. [Overview](#overview)
2. [Core Contracts](#core-contracts)
3. [Adapter Contracts](#adapter-contracts)
4. [Library Contracts](#library-contracts)
5. [Deployment Guide](#deployment-guide)
6. [Contract Interactions](#contract-interactions)
7. [Security Considerations](#security-considerations)

---

## 🎯 OVERVIEW

EngiPay uses a suite of smart contracts deployed on StarkNet to enable:
- **Token Management:** ERC20 token for platform operations
- **Escrow Services:** Protected payments with accept/reject functionality
- **Reward Distribution:** Automated reward distribution to users
- **Cross-Chain Adapters:** Integration with Atomiq and Vesu protocols
- **Governance:** Treasury management and protocol governance

### Contract Architecture

```
EngiPay Smart Contracts
├── Core Contracts
│   ├── EngiToken.cairo          # Platform token (ERC20)
│   ├── EscrowV2.cairo           # Escrow payment system
│   └── RewardDistributorV2.cairo # Reward distribution
├── Adapters
│   ├── AtomiqAdapter.cairo      # Cross-chain swap adapter
│   └── VesuAdapter.cairo        # Lending protocol adapter
├── Bridges
│   └── CrossChainBridge.cairo   # Cross-chain bridge
├── Governance
│   └── Treasury.cairo           # Treasury management
└── Libraries
    ├── AccessControl.cairo      # Role-based access control
    ├── ReentrancyGuard.cairo    # Reentrancy protection
    └── SafeMath.cairo           # Safe math operations
```

---

## 🔷 CORE CONTRACTS

### 1. EngiToken.cairo

**Purpose:** Platform's native ERC20 token

**Features:**
- Standard ERC20 functionality (transfer, approve, transferFrom)
- Minting capability (owner only)
- Burning capability
- Pausable transfers
- Role-based access control

**Key Functions:**
```cairo
// Transfer tokens
fn transfer(recipient: ContractAddress, amount: u256) -> bool

// Approve spending
fn approve(spender: ContractAddress, amount: u256) -> bool

// Transfer from approved address
fn transfer_from(sender: ContractAddress, recipient: ContractAddress, amount: u256) -> bool

// Mint new tokens (owner only)
fn mint(to: ContractAddress, amount: u256)

// Burn tokens
fn burn(amount: u256)

// Pause/unpause transfers (owner only)
fn pause()
fn unpause()
```

**Use Cases:**
- Payment for platform services
- Staking rewards
- Governance voting
- Fee payments

**Deployment:**
```bash
# Deploy EngiToken
starknet deploy --contract EngiToken \
  --inputs <name> <symbol> <decimals> <initial_supply> <owner>
```

---

### 2. EscrowV2.cairo

**Purpose:** Secure escrow system for protected payments

**Features:**
- Create escrow requests with expiry
- Accept/reject payments
- Automatic refunds on expiry
- Fee collection
- Emergency pause

**Key Functions:**
```cairo
// Create escrow request
fn create_escrow(
    recipient: ContractAddress,
    amount: u256,
    token: ContractAddress,
    expiry_time: u64,
    description: felt252
) -> u256  // Returns escrow_id

// Accept payment (recipient only)
fn accept_payment(escrow_id: u256)

// Reject payment (recipient only)
fn reject_payment(escrow_id: u256)

// Cancel escrow (sender only, before acceptance)
fn cancel_escrow(escrow_id: u256)

// Claim expired escrow (sender only, after expiry)
fn claim_expired(escrow_id: u256)

// Get escrow details
fn get_escrow(escrow_id: u256) -> EscrowDetails
```

**Escrow States:**
```
PENDING → ACCEPTED → COMPLETED
       → REJECTED → REFUNDED
       → EXPIRED → REFUNDED
       → CANCELLED → REFUNDED
```

**Use Cases:**
- Freelance payments
- Marketplace transactions
- Service payments with verification
- Protected peer-to-peer transfers

**Deployment:**
```bash
# Deploy EscrowV2
starknet deploy --contract EscrowV2 \
  --inputs <owner> <fee_percentage> <fee_recipient>
```

**Integration Example:**
```typescript
// Frontend integration
import { Contract } from 'starknet';

const escrowContract = new Contract(EscrowABI, escrowAddress, provider);

// Create escrow
const tx = await escrowContract.create_escrow(
  recipientAddress,
  amount,
  tokenAddress,
  expiryTime,
  description
);

// Accept payment
await escrowContract.accept_payment(escrowId);
```

---

### 3. RewardDistributorV2.cairo

**Purpose:** Automated reward distribution system

**Features:**
- Distribute rewards to multiple recipients
- Batch distributions
- Reward claiming
- Vesting schedules
- Emergency withdrawal

**Key Functions:**
```cairo
// Add reward allocation
fn add_reward(
    recipient: ContractAddress,
    amount: u256,
    token: ContractAddress,
    vesting_period: u64
)

// Claim rewards
fn claim_rewards(token: ContractAddress)

// Batch distribute rewards
fn batch_distribute(
    recipients: Array<ContractAddress>,
    amounts: Array<u256>,
    token: ContractAddress
)

// Get claimable rewards
fn get_claimable_rewards(user: ContractAddress, token: ContractAddress) -> u256
```

**Use Cases:**
- Staking rewards
- Referral bonuses
- Liquidity mining rewards
- Airdrop distributions

**Deployment:**
```bash
# Deploy RewardDistributor
starknet deploy --contract RewardDistributorV2 \
  --inputs <owner> <treasury_address>
```

---

## 🔌 ADAPTER CONTRACTS

### 1. AtomiqAdapter.cairo

**Purpose:** Adapter for Atomiq cross-chain swap protocol

**Features:**
- Initiate BTC ↔ STRK swaps
- Track swap status
- Handle swap completion
- Refund failed swaps

**Key Functions:**
```cairo
// Initiate swap
fn initiate_swap(
    from_token: ContractAddress,
    to_token: ContractAddress,
    amount: u256,
    recipient: ContractAddress
) -> u256  // Returns swap_id

// Complete swap
fn complete_swap(swap_id: u256, proof: Array<felt252>)

// Refund failed swap
fn refund_swap(swap_id: u256)

// Get swap status
fn get_swap_status(swap_id: u256) -> SwapStatus
```

**Use Cases:**
- Cross-chain swaps (BTC ↔ STRK)
- Liquidity bridging
- Multi-chain asset management

**Deployment:**
```bash
# Deploy AtomiqAdapter
starknet deploy --contract AtomiqAdapter \
  --inputs <owner> <atomiq_protocol_address>
```

---

### 2. VesuAdapter.cairo

**Purpose:** Adapter for Vesu lending protocol

**Features:**
- Supply assets to Vesu
- Borrow against collateral
- Repay loans
- Withdraw supplied assets

**Key Functions:**
```cairo
// Supply assets
fn supply(
    pool: ContractAddress,
    asset: ContractAddress,
    amount: u256
)

// Borrow assets
fn borrow(
    pool: ContractAddress,
    asset: ContractAddress,
    amount: u256
)

// Repay loan
fn repay(
    pool: ContractAddress,
    asset: ContractAddress,
    amount: u256
)

// Withdraw supplied assets
fn withdraw(
    pool: ContractAddress,
    asset: ContractAddress,
    amount: u256
)
```

**Use Cases:**
- Lending and borrowing
- Yield generation
- Collateralized loans

**Deployment:**
```bash
# Deploy VesuAdapter
starknet deploy --contract VesuAdapter \
  --inputs <owner> <vesu_protocol_address>
```

---

## 🔧 LIBRARY CONTRACTS

### 1. AccessControl.cairo

**Purpose:** Role-based access control system

**Features:**
- Define custom roles
- Grant/revoke roles
- Check role membership
- Role hierarchy

**Key Functions:**
```cairo
// Grant role
fn grant_role(role: felt252, account: ContractAddress)

// Revoke role
fn revoke_role(role: felt252, account: ContractAddress)

// Check if account has role
fn has_role(role: felt252, account: ContractAddress) -> bool

// Renounce role
fn renounce_role(role: felt252)
```

**Common Roles:**
- `ADMIN_ROLE`: Full administrative access
- `MINTER_ROLE`: Can mint tokens
- `PAUSER_ROLE`: Can pause contracts
- `OPERATOR_ROLE`: Can perform operations

---

### 2. ReentrancyGuard.cairo

**Purpose:** Protection against reentrancy attacks

**Features:**
- Mutex lock mechanism
- Automatic lock/unlock
- Gas-efficient implementation

**Usage:**
```cairo
use libraries::ReentrancyGuard;

#[external(v0)]
fn withdraw(amount: u256) {
    ReentrancyGuard::start();  // Lock
    
    // Perform withdrawal logic
    
    ReentrancyGuard::end();    // Unlock
}
```

---

### 3. SafeMath.cairo

**Purpose:** Safe arithmetic operations

**Features:**
- Overflow/underflow protection
- Safe addition, subtraction, multiplication, division
- Modulo operations

**Functions:**
```cairo
fn safe_add(a: u256, b: u256) -> u256
fn safe_sub(a: u256, b: u256) -> u256
fn safe_mul(a: u256, b: u256) -> u256
fn safe_div(a: u256, b: u256) -> u256
fn safe_mod(a: u256, b: u256) -> u256
```

---

## 🚀 DEPLOYMENT GUIDE

### Prerequisites

1. **Starknet CLI:** Install Starknet CLI tools
```bash
pip install cairo-lang
```

2. **Wallet:** Set up StarkNet wallet (ArgentX or Braavos)

3. **Testnet Tokens:** Get testnet STRK from faucet

### Deployment Steps

#### 1. Compile Contracts

```bash
cd smart-contracts

# Compile all contracts
starknet-compile contracts/EngiToken.cairo \
  --output compiled/EngiToken.json

starknet-compile contracts/EscrowV2.cairo \
  --output compiled/EscrowV2.json

starknet-compile contracts/RewardDistributorV2.cairo \
  --output compiled/RewardDistributorV2.json
```

#### 2. Deploy to Testnet

```bash
# Set network
export STARKNET_NETWORK=alpha-goerli

# Deploy EngiToken
starknet deploy --contract compiled/EngiToken.json \
  --inputs \
    1701013862 \  # name (felt252)
    1162892626 \  # symbol (felt252)
    18 \          # decimals
    1000000000000000000000000 \  # initial supply (1M tokens)
    <YOUR_WALLET_ADDRESS>

# Save the contract address
export ENGI_TOKEN_ADDRESS=<deployed_address>

# Deploy EscrowV2
starknet deploy --contract compiled/EscrowV2.json \
  --inputs \
    <YOUR_WALLET_ADDRESS> \  # owner
    250 \                    # fee (2.5%)
    <FEE_RECIPIENT_ADDRESS>

export ESCROW_ADDRESS=<deployed_address>

# Deploy RewardDistributor
starknet deploy --contract compiled/RewardDistributorV2.json \
  --inputs \
    <YOUR_WALLET_ADDRESS> \  # owner
    <TREASURY_ADDRESS>

export REWARD_DISTRIBUTOR_ADDRESS=<deployed_address>
```

#### 3. Verify Contracts

```bash
# Verify on StarkScan
# Visit: https://testnet.starkscan.co/contract/<contract_address>
# Click "Verify Contract"
# Upload source code and ABI
```

#### 4. Update Environment Variables

```env
# Add to .env.local (frontend)
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=<ENGI_TOKEN_ADDRESS>
NEXT_PUBLIC_ESCROW_ADDRESS=<ESCROW_ADDRESS>
NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS=<REWARD_DISTRIBUTOR_ADDRESS>

# Add to backend/.env
ENGI_TOKEN_ADDRESS=<ENGI_TOKEN_ADDRESS>
ESCROW_ADDRESS=<ESCROW_ADDRESS>
REWARD_DISTRIBUTOR_ADDRESS=<REWARD_DISTRIBUTOR_ADDRESS>
```

#### 5. Initialize Contracts

```bash
# Grant roles
starknet invoke \
  --address $ENGI_TOKEN_ADDRESS \
  --abi EngiTokenABI.json \
  --function grant_role \
  --inputs MINTER_ROLE <MINTER_ADDRESS>

# Set escrow fee recipient
starknet invoke \
  --address $ESCROW_ADDRESS \
  --abi EscrowABI.json \
  --function set_fee_recipient \
  --inputs <FEE_RECIPIENT_ADDRESS>
```

### Mainnet Deployment

**⚠️ Before deploying to mainnet:**

1. **Audit:** Get contracts audited by professional auditors
2. **Testing:** Thoroughly test on testnet
3. **Insurance:** Consider smart contract insurance
4. **Multisig:** Use multisig wallet for owner role
5. **Timelock:** Implement timelock for critical functions

```bash
# Deploy to mainnet
export STARKNET_NETWORK=alpha-mainnet

# Follow same deployment steps as testnet
# Use production wallet addresses
# Set appropriate initial parameters
```

---

## 🔄 CONTRACT INTERACTIONS

### Frontend Integration

#### 1. Connect to Contract

```typescript
import { Contract, Provider } from 'starknet';
import EngiTokenABI from './abis/EngiTokenABI.json';

const provider = new Provider({ sequencer: { network: 'mainnet-alpha' } });
const tokenContract = new Contract(
  EngiTokenABI,
  process.env.NEXT_PUBLIC_ENGI_TOKEN_ADDRESS,
  provider
);
```

#### 2. Read Contract Data

```typescript
// Get token balance
const balance = await tokenContract.balanceOf(userAddress);

// Get escrow details
const escrow = await escrowContract.get_escrow(escrowId);

// Get claimable rewards
const rewards = await rewardContract.get_claimable_rewards(
  userAddress,
  tokenAddress
);
```

#### 3. Write to Contract

```typescript
// Connect with signer
import { connect } from 'get-starknet';

const starknet = await connect();
const account = starknet.account;

// Create escrow
const tx = await account.execute({
  contractAddress: escrowAddress,
  entrypoint: 'create_escrow',
  calldata: [
    recipientAddress,
    amount.low,
    amount.high,
    tokenAddress,
    expiryTime,
    description
  ]
});

// Wait for transaction
await provider.waitForTransaction(tx.transaction_hash);
```

### Backend Integration

```javascript
// backend/services/contractService.js
const { Contract, Account, Provider } = require('starknet');

class ContractService {
  constructor() {
    this.provider = new Provider({
      sequencer: { network: process.env.STARKNET_NETWORK }
    });
    
    this.account = new Account(
      this.provider,
      process.env.STARKNET_ACCOUNT_ADDRESS,
      process.env.STARKNET_PRIVATE_KEY
    );
  }

  async createEscrow(recipient, amount, token, expiry, description) {
    const escrowContract = new Contract(
      EscrowABI,
      process.env.ESCROW_ADDRESS,
      this.account
    );

    const tx = await escrowContract.create_escrow(
      recipient,
      amount,
      token,
      expiry,
      description
    );

    return tx.transaction_hash;
  }
}
```

---

## 🔐 SECURITY CONSIDERATIONS

### Best Practices

1. **Access Control**
   - Use role-based access control
   - Implement multi-signature for critical functions
   - Regular role audits

2. **Reentrancy Protection**
   - Use ReentrancyGuard for all external calls
   - Follow checks-effects-interactions pattern
   - Avoid state changes after external calls

3. **Input Validation**
   - Validate all user inputs
   - Check for zero addresses
   - Verify amounts are within limits

4. **Emergency Controls**
   - Implement pause functionality
   - Emergency withdrawal mechanisms
   - Circuit breakers for critical functions

5. **Upgradability**
   - Use proxy patterns for upgradability
   - Implement timelock for upgrades
   - Test upgrades thoroughly on testnet

### Security Checklist

- [ ] Contracts audited by professionals
- [ ] All functions have access control
- [ ] Reentrancy guards in place
- [ ] Input validation implemented
- [ ] Emergency pause functionality
- [ ] Events emitted for all state changes
- [ ] Gas optimization reviewed
- [ ] Tested on testnet extensively
- [ ] Multisig wallet for owner role
- [ ] Documentation complete

### Known Risks

1. **Smart Contract Bugs:** Despite audits, bugs may exist
2. **Protocol Dependencies:** Risks from integrated protocols (Atomiq, Vesu)
3. **Oracle Failures:** Price feed manipulation risks
4. **Network Congestion:** High gas fees during congestion
5. **Regulatory Changes:** Compliance requirements may change

---

## 📊 CONTRACT ADDRESSES

### Testnet (Goerli)

```
EngiToken: [TO BE DEPLOYED]
EscrowV2: [TO BE DEPLOYED]
RewardDistributor: [TO BE DEPLOYED]
AtomiqAdapter: [TO BE DEPLOYED]
VesuAdapter: [TO BE DEPLOYED]
```

### Mainnet

```
EngiToken: [TO BE DEPLOYED]
EscrowV2: [TO BE DEPLOYED]
RewardDistributor: [TO BE DEPLOYED]
AtomiqAdapter: [TO BE DEPLOYED]
VesuAdapter: [TO BE DEPLOYED]
```

---

## 📚 ADDITIONAL RESOURCES

### Documentation
- StarkNet Docs: https://docs.starknet.io/
- Cairo Language: https://www.cairo-lang.org/docs/
- Atomiq Protocol: https://docs.atomiq.exchange/
- Vesu Protocol: https://docs.vesu.xyz/

### Tools
- StarkScan Explorer: https://starkscan.co/
- Voyager Explorer: https://voyager.online/
- StarkNet CLI: https://www.cairo-lang.org/docs/quickstart.html

### Support
- GitHub Issues: [github.com/yourusername/engipay/issues]
- Discord: [discord.gg/engipay]
- Email: contracts@engipay.com

---

**Last Updated:** February 11, 2026  
**Version:** 1.0.0  
**Status:** Ready for Deployment ⚠️ (Audit Pending)
