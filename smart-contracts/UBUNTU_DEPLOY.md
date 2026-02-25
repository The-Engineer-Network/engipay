# Ubuntu/WSL Deployment Guide

## You're Already Set Up! ✓

Since you have Scarb installed in WSL, you're ready to go.

## Quick Deploy (3 Steps)

### Step 1: Navigate to Project
```bash
cd /mnt/c/Users/HP/engipay/smart-contracts
```

### Step 2: Build Contracts
```bash
# Clean and build
scarb clean
scarb build
```

### Step 3: Check Build Output
```bash
# List compiled contracts
ls -lh target/dev/*.contract_class.json
```

## Current Status

Based on your error output, you have these issues:
- ❌ RewardDistributorV2 - Has compilation errors
- ❌ VesuAdapter - Has compilation errors  
- ❌ CrossChainBridge - Has compilation errors
- ❌ Treasury - Has compilation errors

But these should work:
- ✅ EngiToken - Core ERC20 token
- ✅ EscrowV2 - Payment escrow system
- ✅ AtomiqAdapter - Bitcoin swap adapter

## Solution: Deploy Core Contracts Only

I've simplified `lib.cairo` to only include the working contracts. Now try:

```bash
cd /mnt/c/Users/HP/engipay/smart-contracts
scarb build
```

## If Build Succeeds

You'll see compiled contracts in `target/dev/`:
```
engipay_contracts_EngiToken.contract_class.json
engipay_contracts_EscrowV2.contract_class.json
engipay_contracts_AtomiqAdapter.contract_class.json
```

## Deploy Using Starkli

### 1. Setup Account (if not done)
```bash
# Check if you have an account
ls ~/.starkli-wallets/

# If not, create one
starkli account fetch <YOUR_ADDRESS> --output ~/.starkli-wallets/account.json --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7
```

### 2. Deploy EngiToken
```bash
starkli deploy \
  target/dev/engipay_contracts_EngiToken.contract_class.json \
  --network sepolia \
  --account ~/.starkli-wallets/account.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  str:"EngiPay Token" \
  str:"ENGI" \
  u256:1000000000000000000000000 \
  <YOUR_WALLET_ADDRESS>
```

### 3. Deploy EscrowV2
```bash
starkli deploy \
  target/dev/engipay_contracts_EscrowV2.contract_class.json \
  --network sepolia \
  --account ~/.starkli-wallets/account.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  <YOUR_WALLET_ADDRESS> \
  <FEE_RECIPIENT_ADDRESS> \
  u256:250
```

### 4. Deploy AtomiqAdapter
```bash
starkli deploy \
  target/dev/engipay_contracts_AtomiqAdapter.contract_class.json \
  --network sepolia \
  --account ~/.starkli-wallets/account.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
  <YOUR_WALLET_ADDRESS> \
  <FEE_RECIPIENT_ADDRESS> \
  u256:100 \
  u64:86400
```

## Alternative: Use Starknet Remix

If command line is complex, use the web IDE:

1. Go to: https://remix.ethereum.org/
2. Install Starknet plugin
3. Copy your contract code
4. Compile and deploy from the UI

## Troubleshooting

### Error: "Variable was previously moved"
This is a Cairo ownership issue. The simplified lib.cairo should fix this.

### Error: "Trait not found"
Component implementation issues. Fixed by removing problematic contracts.

### Error: "Missing token 'of'"
SafeMath syntax issue. Already fixed.

## What to Do Now

Run this in your Ubuntu terminal:

```bash
cd /mnt/c/Users/HP/engipay/smart-contracts
chmod +x fix-and-build.sh
./fix-and-build.sh
```

This will:
1. Clean old builds
2. Try to build with the simplified contracts
3. Show you what worked

## After Successful Build

Save the deployed addresses to your `.env`:

```env
ENGI_TOKEN_ADDRESS=0x...
ESCROW_CONTRACT_ADDRESS=0x...
ATOMIQ_ADAPTER_ADDRESS=0x...
```

## Need the Other Contracts?

The RewardDistributor, VesuAdapter, etc. have Cairo 2.x compatibility issues. Options:

1. **Use them later** - Deploy core contracts now, fix others later
2. **Use existing protocols** - Integrate with existing Vesu/Ekubo contracts
3. **Simplify them** - Remove complex features causing errors

## Quick Commands Reference

```bash
# Build
scarb build

# Clean
scarb clean

# Check version
scarb --version

# Deploy (after build)
starkli deploy <contract.json> --network sepolia ...
```

## Get Help

If you see errors, paste them and I'll help fix the specific issues.
