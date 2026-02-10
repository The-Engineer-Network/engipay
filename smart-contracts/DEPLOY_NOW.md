# 🚀 Deploy Your Smart Contracts NOW

All critical issues are fixed! Follow these steps to deploy.

---

## ⚡ Quick Deploy (5 Steps)

### Step 1: Install Dependencies (if not done)

```bash
cd smart-contracts
npm install
```

### Step 2: Configure Environment

Create `.env` file in `smart-contracts/` directory:

```env
# Network (use 'sepolia' for testing first)
STARKNET_NETWORK=sepolia

# Your StarkNet account details
DEPLOYER_PRIVATE_KEY=0x_your_private_key_here
DEPLOYER_ADDRESS=0x_your_account_address_here

# Contract parameters
ENGI_TOKEN_NAME=EngiToken
ENGI_TOKEN_SYMBOL=ENGI
ENGI_INITIAL_SUPPLY=1000000000000000000000000
PLATFORM_FEE_BASIS_POINTS=50
REWARD_RATE_PER_SECOND=1000000000000000000
```

### Step 3: Compile Contracts

```bash
# Make sure you're in smart-contracts directory
cd smart-contracts

# Compile all contracts
npm run compile
```

**Expected Output**:
```
✅ Compiled EngiToken.cairo
✅ Compiled EscrowV2.cairo
✅ Compiled RewardDistributorV2.cairo
✅ Compiled VesuAdapter.cairo
✅ Compiled AtomiqAdapter.cairo
✅ Compiled CrossChainBridge.cairo
✅ Compiled Treasury.cairo
```

### Step 4: Deploy to Testnet (RECOMMENDED FIRST)

```bash
# Deploy to Sepolia testnet
STARKNET_NETWORK=sepolia npm run deploy
```

**Expected Output**:
```
🚀 Deploying to Sepolia testnet...

✅ EngiToken deployed: 0x0123...
✅ EscrowV2 deployed: 0x0456...
✅ RewardDistributorV2 deployed: 0x0789...
✅ VesuAdapter deployed: 0x0abc...
✅ AtomiqAdapter deployed: 0x0def...
✅ CrossChainBridge deployed: 0x0ghi...
✅ Treasury deployed: 0x0jkl...

📝 Deployment addresses saved to deployments.json
```

### Step 5: Deploy to Mainnet (After Testing)

```bash
# Deploy to mainnet
STARKNET_NETWORK=mainnet npm run deploy
```

---

## 📋 Pre-Deployment Checklist

Before deploying to mainnet, ensure:

- [ ] You have a funded StarkNet wallet
- [ ] You have at least 0.1 ETH for gas fees
- [ ] You've tested on Sepolia testnet first
- [ ] You've backed up your private keys
- [ ] You've verified contract addresses on testnet
- [ ] You've tested basic functionality on testnet

---

## 🔍 Verify Deployment

### Check on StarkScan

**Testnet**: https://sepolia.starkscan.co/  
**Mainnet**: https://starkscan.co/

Search for your contract addresses to verify deployment.

### Test Contract Functions

```bash
# Test EngiToken
starknet call --address <ENGI_TOKEN_ADDRESS> --abi artifacts/EngiToken.json --function total_supply

# Test EscrowV2
starknet call --address <ESCROW_ADDRESS> --abi artifacts/EscrowV2.json --function get_platform_fee
```

---

## 🔧 If Compilation Fails

### Common Issues:

**Issue 1: Cairo compiler not found**
```bash
# Install StarkNet tools
npm install -g @starknet-foundry/starknet-foundry
```

**Issue 2: Module not found**
```bash
# Make sure you're in the right directory
cd smart-contracts
pwd  # Should show .../engipay/smart-contracts
```

**Issue 3: Syntax errors**
```bash
# Check which file has errors
npm run compile 2>&1 | grep "Error"

# The fixes we applied should have resolved all syntax errors
# If you still see errors, check the file mentioned
```

---

## 📱 Update Frontend After Deployment

After successful deployment, update your main `.env.local`:

```env
# Smart Contract Addresses (from deployments.json)
NEXT_PUBLIC_ENGI_TOKEN_CONTRACT=0x...
NEXT_PUBLIC_ESCROW_CONTRACT=0x...
NEXT_PUBLIC_REWARD_DISTRIBUTOR_CONTRACT=0x...
NEXT_PUBLIC_VESU_ADAPTER_CONTRACT=0x...
NEXT_PUBLIC_ATOMIQ_ADAPTER_CONTRACT=0x...
NEXT_PUBLIC_CROSS_CHAIN_BRIDGE_CONTRACT=0x...
NEXT_PUBLIC_TREASURY_CONTRACT=0x...

# StarkNet Configuration
NEXT_PUBLIC_STARKNET_RPC_URL=https://starknet-mainnet.public.blastapi.io
NEXT_PUBLIC_STARKNET_CHAIN_ID=0x534e5f4d41494e
```

---

## 🎯 Deployment Order

Contracts will be deployed in this order:

1. **Libraries** (IERC20, SafeMath, AccessControl, ReentrancyGuard)
2. **EngiToken** (governance token)
3. **Treasury** (fee management)
4. **EscrowV2** (payment escrow)
5. **RewardDistributorV2** (staking rewards)
6. **VesuAdapter** (DeFi lending)
7. **AtomiqAdapter** (cross-chain swaps)
8. **CrossChainBridge** (bridge infrastructure)

---

## 💰 Gas Cost Estimates

| Contract | Estimated Gas (ETH) |
|----------|-------------------|
| EngiToken | 0.01 - 0.02 |
| EscrowV2 | 0.01 - 0.02 |
| RewardDistributorV2 | 0.01 - 0.02 |
| VesuAdapter | 0.01 - 0.02 |
| AtomiqAdapter | 0.01 - 0.02 |
| CrossChainBridge | 0.02 - 0.03 |
| Treasury | 0.01 - 0.02 |
| **Total** | **0.08 - 0.15 ETH** |

*Prices vary based on network congestion*

---

## 🆘 Need Help?

### Deployment Issues

If deployment fails:
1. Check your wallet has sufficient ETH
2. Verify your private key is correct
3. Check network connectivity
4. Try deploying one contract at a time

### Contract Issues

If contracts don't work as expected:
1. Verify contract addresses are correct
2. Check you're on the right network (testnet vs mainnet)
3. Ensure contracts are verified on StarkScan
4. Test with small amounts first

---

## ✅ Success Indicators

You'll know deployment was successful when:

- ✅ All contracts compile without errors
- ✅ Deployment script completes without errors
- ✅ `deployments.json` file is created with addresses
- ✅ Contracts are visible on StarkScan
- ✅ Basic contract calls work (e.g., `total_supply()`)

---

## 🎉 After Successful Deployment

1. **Save Addresses**: Copy `deployments.json` to a safe location
2. **Update Frontend**: Add contract addresses to `.env.local`
3. **Test Integration**: Test frontend with deployed contracts
4. **Monitor**: Watch for any unusual activity
5. **Document**: Keep records of all deployment transactions

---

## 📞 Quick Commands Reference

```bash
# Compile
npm run compile

# Deploy to testnet
STARKNET_NETWORK=sepolia npm run deploy

# Deploy to mainnet
STARKNET_NETWORK=mainnet npm run deploy

# Check deployment
cat deployments.json

# Verify on explorer
# Visit: https://starkscan.co/contract/<YOUR_CONTRACT_ADDRESS>
```

---

**You're all set! Start with Step 1 and deploy your contracts! 🚀**

**Remember**: Always test on Sepolia testnet first before deploying to mainnet!
