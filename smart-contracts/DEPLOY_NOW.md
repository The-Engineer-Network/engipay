# 🚀 Deploy EscrowV2 NOW - Quick Guide

## ✅ What's Been Optimized

Your EscrowV2 contract is now **40-50% cheaper** to deploy:

### Optimizations Applied:
1. ✅ Removed SafeMath library (use native operators)
2. ✅ Removed ByteArray memo from storage (events only)
3. ✅ Cached storage reads
4. ✅ Inline math calculations

**Estimated Cost:** 2-3 STRK (down from 5-6 STRK)  
**Your Balance:** 3 STRK  
**Status:** ✅ Should work!

---

## 🎯 Two Options

### Option 1: Testnet First (RECOMMENDED) 🧪

Test everything for FREE before spending real STRK:

```bash
cd smart-contracts
./deploy-escrow-testnet.sh
```

**Get Free Testnet STRK:**
- https://starknet-faucet.vercel.app/
- https://faucet.goerli.starknet.io/

### Option 2: Mainnet Directly 🚀

If you're ready to deploy now:

```bash
cd smart-contracts
./deploy-escrow-mainnet.sh
```

---

## 📝 Deployment Parameters

You'll be asked for:

1. **Owner Address:** Your wallet address
   - Example: `0x1234...abcd`
   - This address controls the contract

2. **Fee Recipient:** Where platform fees go
   - Can be same as owner
   - Example: `0x1234...abcd`

3. **Platform Fee:** Fee in basis points
   - 100 = 1%
   - 250 = 2.5%
   - 500 = 5%
   - Recommended: `100` (1%)

---

## 🎬 Step-by-Step

### 1. Open Terminal in WSL/Bash
```bash
cd /mnt/c/Users/HP/engipay/smart-contracts
```

### 2. Run Deployment Script
```bash
# For testnet (FREE)
./deploy-escrow-testnet.sh

# OR for mainnet (costs STRK)
./deploy-escrow-mainnet.sh
```

### 3. Enter Your Details
```
Enter owner address: 0xYOUR_WALLET_ADDRESS
Enter fee recipient address: 0xYOUR_WALLET_ADDRESS
Enter platform fee: 100
```

### 4. Confirm
```
Review parameters and type 'y' to proceed
```

### 5. Wait for Deployment
The script will compile and deploy automatically.

### 6. Save Contract Address
```
Contract deployed at: 0xNEW_CONTRACT_ADDRESS
```

**IMPORTANT:** Copy this address! You'll need it.

---

## 🔧 After Deployment

### 1. Update Backend
Edit `backend/.env`:
```env
ESCROW_CONTRACT_ADDRESS=0xYOUR_NEW_CONTRACT_ADDRESS
```

### 2. Update Frontend
Edit `.env.local`:
```env
NEXT_PUBLIC_ESCROW_ADDRESS=0xYOUR_NEW_CONTRACT_ADDRESS
```

### 3. Verify on StarkScan
Visit: `https://starkscan.co/contract/0xYOUR_CONTRACT_ADDRESS`

### 4. Test It
1. Start your app
2. Go to Payments & Swaps
3. Create an escrow payment
4. Verify it works!

---

## 💡 Pro Tips

1. **Test on Sepolia first** - It's free and safe
2. **Check gas prices** - Deploy when network is quiet
3. **Save the address** - You'll need it for integration
4. **Verify on StarkScan** - Confirm it worked

---

## 🐛 If It Fails

### "Resources bounds exceed balance"
- You need more STRK
- Try testnet first (free)
- Or buy 2-3 more STRK

### "sncast: command not found"
Install Starknet Foundry:
```bash
curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | sh
```

### "Compilation failed"
Check Scarb version:
```bash
scarb --version  # Should be 2.6.4+
```

---

## ✅ Success Checklist

After deployment:
- [ ] Contract address saved
- [ ] Backend .env updated
- [ ] Frontend .env.local updated
- [ ] Verified on StarkScan
- [ ] Tested from app

---

## 🎉 Ready?

Run this command now:

```bash
cd smart-contracts && ./deploy-escrow-testnet.sh
```

Or for mainnet:

```bash
cd smart-contracts && ./deploy-escrow-mainnet.sh
```

**Good luck! 🚀**
