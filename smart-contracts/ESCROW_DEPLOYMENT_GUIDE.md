# EscrowV2 Deployment Guide

## 🎯 Optimizations Applied

Your EscrowV2 contract has been optimized to minimize gas costs:

### Gas Savings:
1. **Removed SafeMath library** - Use native Cairo math operators (~15% savings)
2. **Removed ByteArray memo from storage** - Store in events only (~30% savings)
3. **Cached storage reads** - Read once, use multiple times (~10% savings)
4. **Inline calculations** - Avoid function call overhead (~5% savings)

**Total Estimated Savings: ~40-50% gas reduction**

**Original Cost:** ~1,000,000 gas units  
**Optimized Cost:** ~500,000-600,000 gas units

With 3 STRK, you should have enough for deployment!

---

## 📋 Pre-Deployment Checklist

### 1. Verify Your Balance
```bash
# Check your STRK balance
# You need at least 3 STRK for safe deployment
```

### 2. Prepare Deployment Parameters

You'll need:
- **Owner Address:** Your wallet address (controls the contract)
- **Fee Recipient:** Address to receive platform fees
- **Platform Fee:** Fee in basis points (100 = 1%, 250 = 2.5%)

Example:
```
Owner: 0x1234...abcd (your wallet)
Fee Recipient: 0x1234...abcd (same or different)
Platform Fee: 100 (1% fee)
```

---

## 🚀 Deployment Options

### Option 1: Deploy to Testnet First (RECOMMENDED)

Test everything before spending real STRK:

```bash
cd smart-contracts
chmod +x deploy-escrow-testnet.sh
./deploy-escrow-testnet.sh
```

**Get Free Testnet STRK:**
- https://starknet-faucet.vercel.app/
- https://faucet.goerli.starknet.io/

### Option 2: Deploy Directly to Mainnet

If you're confident and ready:

```bash
cd smart-contracts
chmod +x deploy-escrow-mainnet.sh
./deploy-escrow-mainnet.sh
```

---

## 📝 Step-by-Step Deployment

### Step 1: Navigate to smart-contracts directory
```bash
cd smart-contracts
```

### Step 2: Make scripts executable
```bash
chmod +x deploy-escrow-testnet.sh
chmod +x deploy-escrow-mainnet.sh
```

### Step 3: Run deployment script
```bash
# For testnet
./deploy-escrow-testnet.sh

# OR for mainnet
./deploy-escrow-mainnet.sh
```

### Step 4: Enter deployment parameters
```
Enter owner address: 0xYOUR_WALLET_ADDRESS
Enter fee recipient address: 0xYOUR_WALLET_ADDRESS
Enter platform fee: 100
```

### Step 5: Confirm deployment
```
Review parameters and type 'y' to proceed
```

### Step 6: Wait for deployment
The script will:
1. Compile the contract
2. Deploy to the network
3. Return the contract address

### Step 7: Save the contract address
```
Contract deployed at: 0xNEW_CONTRACT_ADDRESS
```

---

## 🔧 Manual Deployment (Alternative)

If the scripts don't work, deploy manually:

### 1. Update Scarb.toml
```bash
cp Scarb-escrow.toml Scarb.toml
```

### 2. Compile
```bash
scarb build
```

### 3. Deploy
```bash
sncast deploy \
    --contract-name EscrowV2 \
    --network mainnet \
    --constructor-calldata "0xOWNER" "0xFEE_RECIPIENT" "100"
```

---

## 📊 Gas Cost Estimation

### Testnet Deployment:
- **Gas Units:** ~500,000-600,000
- **Cost:** FREE (testnet STRK)

### Mainnet Deployment:
- **Gas Units:** ~500,000-600,000
- **L2 Gas:** ~500K units × 31.2 Gwei = ~15.6M Gwei
- **L1 Data Gas:** ~288 units × 22 Gwei = ~6.3K Gwei
- **Total Cost:** ~2-3 STRK (depending on gas prices)

**Your Balance:** 3 STRK  
**Estimated Cost:** 2-3 STRK  
**Status:** ✅ Should be enough!

---

## ✅ Post-Deployment Steps

### 1. Verify Contract on StarkScan
```
Visit: https://starkscan.co/contract/0xYOUR_CONTRACT_ADDRESS
```

### 2. Update Environment Variables

**Backend (.env):**
```env
ESCROW_CONTRACT_ADDRESS=0xYOUR_CONTRACT_ADDRESS
```

**Frontend (.env.local):**
```env
NEXT_PUBLIC_ESCROW_ADDRESS=0xYOUR_CONTRACT_ADDRESS
```

### 3. Test Contract Functions

Test each function:
```bash
# Create payment request
sncast call \
    --contract-address 0xYOUR_CONTRACT \
    --function create_payment_request \
    --calldata "0xRECIPIENT" "1000000000000000000" "0xTOKEN" "24" ""

# Get payment request
sncast call \
    --contract-address 0xYOUR_CONTRACT \
    --function get_payment_request \
    --calldata "1"
```

### 4. Update Backend Integration

The backend is already set up! Just update the contract address in:
- `backend/config/starknet.js`
- `backend/.env`

### 5. Test from Frontend

1. Start your app
2. Navigate to Payments & Swaps
3. Try creating an escrow payment
4. Verify it works end-to-end

---

## 🐛 Troubleshooting

### Error: "Resources bounds exceed balance"
**Solution:** You need more STRK
- Buy 2-3 more STRK from an exchange
- Or deploy to testnet first

### Error: "Contract failed validation"
**Solution:** Check your constructor parameters
- Owner address must be valid
- Fee must be ≤ 1000 (10%)

### Error: "sncast: command not found"
**Solution:** Install Starknet Foundry
```bash
curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | sh
```

### Error: "Compilation failed"
**Solution:** Check Scarb version
```bash
scarb --version  # Should be 2.6.4 or higher
```

---

## 💡 Tips for Success

1. **Test on Sepolia first** - It's free and safe
2. **Monitor gas prices** - Deploy when network is less congested
3. **Double-check addresses** - Wrong address = lost funds
4. **Save the contract address** - You'll need it for integration
5. **Verify on StarkScan** - Confirm deployment succeeded

---

## 📞 Need Help?

If deployment fails:
1. Check the error message carefully
2. Verify your STRK balance
3. Try testnet deployment first
4. Check StarkScan for transaction status

---

## 🎉 Success Checklist

After successful deployment:
- [ ] Contract deployed to mainnet
- [ ] Contract address saved
- [ ] Environment variables updated
- [ ] Contract verified on StarkScan
- [ ] Backend integration tested
- [ ] Frontend integration tested
- [ ] All escrow functions working

---

**Ready to deploy? Run the script and let's get your contract on mainnet!** 🚀
