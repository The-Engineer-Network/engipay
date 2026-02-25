# 🚀 EngiPay Smart Contract Deployment Guide

**Network:** StarkNet Sepolia Testnet  
**Date:** February 20, 2026

---

## 📋 PRE-DEPLOYMENT CHECKLIST

### 1. Environment Setup
- [ ] StarkNet CLI installed (`starkli --version`)
- [ ] Account created and funded with testnet ETH
- [ ] Private key securely stored in `.env`
- [ ] RPC endpoint configured

### 2. Contract Compilation
```bash
cd smart-contracts
scarb build
```

### 3. Account Configuration
```bash
# Export account details
export STARKNET_ACCOUNT=~/.starknet_accounts/deployer.json
export STARKNET_RPC=https://rpc.starknet.lava.build
```

---

## 🔐 DEPLOYMENT ORDER

Deploy contracts in this specific order due to dependencies:

### 1. EngiToken (ERC20)
**Purpose:** Platform token for payments and rewards

```bash
starknet deploy \
  --contract target/release/EngiToken.json \
  --inputs \
    0x456e6769546f6b656e  # name: "EngiToken"
    0x454e4749  # symbol: "ENGI"
    18  # decimals
    1000000000000000000000000  # initial_supply: 1M tokens
    $DEPLOYER_ADDRESS  # owner
```

**Post-deployment:**
- Save contract address to `.env` as `ENGI_TOKEN_ADDRESS`
- Verify on StarkScan

### 2. EscrowV2
**Purpose:** Protected payment system

```bash
starknet deploy \
  --contract target/release/EscrowV2.json \
  --inputs \
    $DEPLOYER_ADDRESS  # owner
    $ENGI_TOKEN_ADDRESS  # payment token
    250  # fee_basis_points (2.5%)
```

**Post-deployment:**
- Save contract address to `.env` as `ESCROW_ADDRESS`
- Verify on StarkScan

### 3. RewardDistributorV2
**Purpose:** Automated reward distribution

```bash
starknet deploy \
  --contract target/release/RewardDistributorV2.json \
  --inputs \
    $DEPLOYER_ADDRESS  # owner
    $ENGI_TOKEN_ADDRESS  # reward token
```

**Post-deployment:**
- Save contract address to `.env` as `REWARD_DISTRIBUTOR_ADDRESS`
- Verify on StarkScan

### 4. AtomiqAdapter
**Purpose:** Cross-chain swap adapter

```bash
starknet deploy \
  --contract target/release/AtomiqAdapter.json \
  --inputs \
    $DEPLOYER_ADDRESS  # owner
    $ATOMIQ_PROTOCOL_ADDRESS  # Atomiq protocol address
```

**Post-deployment:**
- Save contract address to `.env` as `ATOMIQ_ADAPTER_ADDRESS`
- Verify on StarkScan

### 5. VesuAdapter
**Purpose:** Lending protocol adapter

```bash
starknet deploy \
  --contract target/release/VesuAdapter.json \
  --inputs \
    $DEPLOYER_ADDRESS  # owner
    $VESU_PROTOCOL_ADDRESS  # Vesu protocol address
```

**Post-deployment:**
- Save contract address to `.env` as `VESU_ADAPTER_ADDRESS`
- Verify on StarkScan

---

## 🔧 POST-DEPLOYMENT CONFIGURATION

### 1. Update Environment Variables

**Frontend (`.env.local`):**
```bash
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_ESCROW_ADDRESS=0x...
NEXT_PUBLIC_REWARD_DISTRIBUTOR_ADDRESS=0x...
NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=0x...
NEXT_PUBLIC_VESU_ADAPTER_ADDRESS=0x...
```

**Backend (`backend/.env`):**
```bash
ENGI_TOKEN_ADDRESS=0x...
ESCROW_ADDRESS=0x...
REWARD_DISTRIBUTOR_ADDRESS=0x...
ATOMIQ_ADAPTER_ADDRESS=0x...
VESU_ADAPTER_ADDRESS=0x...
```

### 2. Grant Permissions

**EngiToken - Mint Permission:**
```bash
starknet invoke \
  --contract $ENGI_TOKEN_ADDRESS \
  --function grantRole \
  --inputs \
    0x4d494e5445525f524f4c45  # MINTER_ROLE
    $REWARD_DISTRIBUTOR_ADDRESS
```

**EscrowV2 - Operator Permission:**
```bash
starknet invoke \
  --contract $ESCROW_ADDRESS \
  --function grantRole \
  --inputs \
    0x4f50455241544f525f524f4c45  # OPERATOR_ROLE
    $BACKEND_SERVICE_ADDRESS
```

### 3. Verify Contracts on StarkScan

For each contract:
1. Go to https://sepolia.starkscan.co
2. Search for contract address
3. Click "Verify Contract"
4. Upload source code and ABI
5. Confirm verification

---

## 🧪 TESTING DEPLOYED CONTRACTS

### 1. Test EngiToken
```bash
# Check balance
starknet call \
  --contract $ENGI_TOKEN_ADDRESS \
  --function balanceOf \
  --inputs $DEPLOYER_ADDRESS

# Transfer tokens
starknet invoke \
  --contract $ENGI_TOKEN_ADDRESS \
  --function transfer \
  --inputs \
    $RECIPIENT_ADDRESS \
    1000000000000000000  # 1 token
```

### 2. Test Escrow
```bash
# Create escrow payment
starknet invoke \
  --contract $ESCROW_ADDRESS \
  --function createPayment \
  --inputs \
    $RECIPIENT_ADDRESS \
    1000000000000000000  # 1 token
    1740000000  # expiry timestamp
```

### 3. Test Reward Distributor
```bash
# Distribute rewards
starknet invoke \
  --contract $REWARD_DISTRIBUTOR_ADDRESS \
  --function distributeRewards \
  --inputs \
    1  # number of recipients
    $RECIPIENT_ADDRESS \
    1000000000000000000  # 1 token
```

---

## 📊 DEPLOYMENT SUMMARY TEMPLATE

After deployment, fill this out:

```
=== EngiPay Smart Contract Deployment ===
Network: StarkNet Sepolia Testnet
Date: [DATE]
Deployer: [ADDRESS]

Contract Addresses:
- EngiToken: 0x...
- EscrowV2: 0x...
- RewardDistributorV2: 0x...
- AtomiqAdapter: 0x...
- VesuAdapter: 0x...

Verification Status:
- EngiToken: [✅/❌]
- EscrowV2: [✅/❌]
- RewardDistributorV2: [✅/❌]
- AtomiqAdapter: [✅/❌]
- VesuAdapter: [✅/❌]

StarkScan Links:
- EngiToken: https://sepolia.starkscan.co/contract/0x...
- EscrowV2: https://sepolia.starkscan.co/contract/0x...
- RewardDistributorV2: https://sepolia.starkscan.co/contract/0x...
- AtomiqAdapter: https://sepolia.starkscan.co/contract/0x...
- VesuAdapter: https://sepolia.starkscan.co/contract/0x...
```

---

## 🚨 TROUBLESHOOTING

### Issue: "Account not found"
**Solution:** Ensure account is created and funded
```bash
starkli account fetch $ACCOUNT_ADDRESS --rpc $STARKNET_RPC
```

### Issue: "Insufficient balance"
**Solution:** Fund account with testnet ETH
- Get testnet ETH from: https://faucet.goerli.starknet.io

### Issue: "Contract already deployed"
**Solution:** Use existing address or deploy with different salt

### Issue: "RPC connection failed"
**Solution:** Try alternative RPC endpoint
```bash
export STARKNET_RPC=https://starknet-sepolia.g.alchemy.com/v2/YOUR_KEY
```

---

## 📝 QUICK DEPLOYMENT SCRIPT

Save this as `deploy-all.sh`:

```bash
#!/bin/bash

# Load environment variables
source .env

# Deploy EngiToken
echo "Deploying EngiToken..."
ENGI_TOKEN=$(starknet deploy --contract target/release/EngiToken.json --inputs ...)
echo "EngiToken deployed at: $ENGI_TOKEN"

# Deploy EscrowV2
echo "Deploying EscrowV2..."
ESCROW=$(starknet deploy --contract target/release/EscrowV2.json --inputs ...)
echo "EscrowV2 deployed at: $ESCROW"

# Deploy RewardDistributorV2
echo "Deploying RewardDistributorV2..."
REWARD_DIST=$(starknet deploy --contract target/release/RewardDistributorV2.json --inputs ...)
echo "RewardDistributorV2 deployed at: $REWARD_DIST"

# Deploy AtomiqAdapter
echo "Deploying AtomiqAdapter..."
ATOMIQ_ADAPTER=$(starknet deploy --contract target/release/AtomiqAdapter.json --inputs ...)
echo "AtomiqAdapter deployed at: $ATOMIQ_ADAPTER"

# Deploy VesuAdapter
echo "Deploying VesuAdapter..."
VESU_ADAPTER=$(starknet deploy --contract target/release/VesuAdapter.json --inputs ...)
echo "VesuAdapter deployed at: $VESU_ADAPTER"

echo "✅ All contracts deployed successfully!"
echo "Update your .env files with these addresses"
```

---

## 🎯 NEXT STEPS AFTER DEPLOYMENT

1. **Update all environment files** with contract addresses
2. **Restart backend server** to load new addresses
3. **Restart frontend** to load new addresses
4. **Run integration tests** to verify everything works
5. **Test all features** end-to-end
6. **Monitor transactions** on StarkScan
7. **Document deployment** in project README

---

**Deployment Time Estimate:** 2-3 hours  
**Required Testnet ETH:** ~0.5 ETH for all deployments
