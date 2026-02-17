# 🚀 Deploy All 3 Contracts - Complete Guide

**Estimated Time:** 2.5 hours  
**Contracts:** AtomiqAdapter, EngiToken, EscrowV2

---

## ✅ PRE-DEPLOYMENT VERIFICATION

### All Contracts Ready ✅
- [x] EngiToken.cairo - Complete
- [x] EscrowV2.cairo - Complete  
- [x] AtomiqAdapter.cairo - Complete
- [x] SafeMath.cairo - Complete
- [x] AccessControl.cairo - Complete
- [x] ReentrancyGuard.cairo - Complete
- [x] IERC20.cairo - Complete

### Prerequisites Checklist
- [ ] Scarb installed (v2.6.0 or later)
- [ ] Starkli installed (for deployment)
- [ ] StarkNet wallet with testnet STRK
- [ ] RPC endpoint configured

---

## 📦 STEP 1: Install Tools (15 minutes)

### Install Scarb (Cairo Package Manager)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh
```

Verify installation:
```bash
scarb --version
# Should show: scarb 2.6.0 or later
```

### Install Starkli (Deployment Tool)
```bash
curl https://get.starkli.sh | sh
starkliup
```

Verify installation:
```bash
starkli --version
```

### Get Testnet STRK Tokens
Visit: https://starknet-faucet.vercel.app/
- Connect your wallet
- Request testnet STRK tokens
- Wait for confirmation

---

## 🔧 STEP 2: Setup Project (10 minutes)

### Create Scarb.toml Configuration
```bash
cd smart-contracts
```

Create `Scarb.toml`:
```toml
[package]
name = "engipay_contracts"
version = "1.0.0"
edition = "2024_07"

[dependencies]
starknet = ">=2.6.0"

[[target.starknet-contract]]
sierra = true
casm = true

[tool.snforge]
exit_first = true
```

### Verify Project Structure
```
smart-contracts/
├── Scarb.toml
├── contracts/
│   ├── EngiToken.cairo
│   ├── EscrowV2.cairo
│   ├── adapters/
│   │   └── AtomiqAdapter.cairo
│   ├── libraries/
│   │   ├── SafeMath.cairo
│   │   ├── AccessControl.cairo
│   │   └── ReentrancyGuard.cairo
│   └── interfaces/
│       └── IERC20.cairo
```

---

## 🔨 STEP 3: Compile Contracts (20 minutes)

### Compile All Contracts
```bash
cd smart-contracts
scarb build
```

Expected output:
```
   Compiling engipay_contracts v1.0.0
    Finished release target(s) in X seconds
```

### Verify Compiled Files
```bash
ls -la target/dev/
```

You should see:
- `engipay_contracts_EngiToken.contract_class.json`
- `engipay_contracts_EscrowV2.contract_class.json`
- `engipay_contracts_AtomiqAdapter.contract_class.json`

---

## 🌐 STEP 4: Setup Wallet & RPC (10 minutes)

### Configure Starkli Account
```bash
# Create account descriptor
starkli account fetch <YOUR_WALLET_ADDRESS> \
  --rpc https://starknet-sepolia.public.blastapi.io \
  --output ~/.starkli-wallets/deployer/account.json

# Create signer (if using keystore)
starkli signer keystore from-key ~/.starkli-wallets/deployer/keystore.json
```

### Set Environment Variables
```bash
export STARKNET_ACCOUNT=~/.starkli-wallets/deployer/account.json
export STARKNET_KEYSTORE=~/.starkli-wallets/deployer/keystore.json
export STARKNET_RPC=https://starknet-sepolia.public.blastapi.io
```

---

## 🚀 STEP 5: Deploy Contracts (90 minutes)

### 5.1 Deploy EngiToken (30 minutes)

```bash
# Declare the contract class
starkli declare \
  target/dev/engipay_contracts_EngiToken.contract_class.json \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE

# Save the class hash from output
export ENGI_TOKEN_CLASS_HASH=<class_hash_from_output>

# Deploy the contract
starkli deploy \
  $ENGI_TOKEN_CLASS_HASH \
  str:EngiPay \
  str:ENGI \
  u256:1000000000000000000000000 \
  <YOUR_WALLET_ADDRESS> \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE

# Save the contract address
export ENGI_TOKEN_ADDRESS=<contract_address_from_output>
```

**Constructor Parameters:**
- `name`: "EngiPay" (string)
- `symbol`: "ENGI" (string)
- `initial_supply`: 1,000,000 tokens (with 18 decimals)
- `owner`: Your wallet address

### 5.2 Deploy EscrowV2 (30 minutes)

```bash
# Declare the contract class
starkli declare \
  target/dev/engipay_contracts_EscrowV2.contract_class.json \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE

# Save the class hash
export ESCROW_CLASS_HASH=<class_hash_from_output>

# Deploy the contract
starkli deploy \
  $ESCROW_CLASS_HASH \
  <YOUR_WALLET_ADDRESS> \
  <FEE_RECIPIENT_ADDRESS> \
  u256:250 \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE

# Save the contract address
export ESCROW_ADDRESS=<contract_address_from_output>
```

**Constructor Parameters:**
- `owner`: Your wallet address
- `fee_recipient`: Address to receive platform fees
- `platform_fee`: 250 (2.5% in basis points)

### 5.3 Deploy AtomiqAdapter (30 minutes)

```bash
# Declare the contract class
starkli declare \
  target/dev/engipay_contracts_AtomiqAdapter.contract_class.json \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE

# Save the class hash
export ATOMIQ_CLASS_HASH=<class_hash_from_output>

# Deploy the contract
starkli deploy \
  $ATOMIQ_CLASS_HASH \
  <YOUR_WALLET_ADDRESS> \
  <FEE_RECIPIENT_ADDRESS> \
  u256:50 \
  u64:86400 \
  --rpc $STARKNET_RPC \
  --account $STARKNET_ACCOUNT \
  --keystore $STARKNET_KEYSTORE

# Save the contract address
export ATOMIQ_ADAPTER_ADDRESS=<contract_address_from_output>
```

**Constructor Parameters:**
- `owner`: Your wallet address
- `fee_recipient`: Address to receive platform fees
- `platform_fee`: 50 (0.5% in basis points)
- `swap_timeout`: 86400 (24 hours in seconds)

---

## ✅ STEP 6: Verify Contracts (30 minutes)

### Verify on Voyager/StarkScan

1. Visit https://sepolia.voyager.online/
2. Search for each contract address
3. Click "Verify Contract"
4. Upload the contract source code
5. Confirm verification

### Test Contract Calls

```bash
# Test EngiToken - Get name
starkli call \
  $ENGI_TOKEN_ADDRESS \
  name \
  --rpc $STARKNET_RPC

# Test EscrowV2 - Get platform fee
starkli call \
  $ESCROW_ADDRESS \
  get_platform_fee \
  --rpc $STARKNET_RPC

# Test AtomiqAdapter - Get swap count
starkli call \
  $ATOMIQ_ADAPTER_ADDRESS \
  get_swap_count \
  --rpc $STARKNET_RPC
```

---

## 📝 STEP 7: Update Environment Variables (10 minutes)

### Frontend (.env.local)
```env
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=<ENGI_TOKEN_ADDRESS>
NEXT_PUBLIC_ESCROW_ADDRESS=<ESCROW_ADDRESS>
NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=<ATOMIQ_ADAPTER_ADDRESS>
NEXT_PUBLIC_STARKNET_NETWORK=sepolia
```

### Backend (backend/.env)
```env
ENGI_TOKEN_ADDRESS=<ENGI_TOKEN_ADDRESS>
ESCROW_CONTRACT_ADDRESS=<ESCROW_ADDRESS>
ATOMIQ_ADAPTER_ADDRESS=<ATOMIQ_ADAPTER_ADDRESS>
STARKNET_NETWORK=sepolia
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io
```

---

## 🧪 STEP 8: Test Integration (15 minutes)

### Test EngiToken Integration
```bash
# From your project root
cd backend
node -e "
const { Contract, RpcProvider } = require('starknet');
const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });
const contract = new Contract(
  require('./contracts/EngiTokenABI.json'),
  process.env.ENGI_TOKEN_ADDRESS,
  provider
);
contract.name().then(name => console.log('Token name:', name));
"
```

### Test Escrow Integration
```bash
node -e "
const { Contract, RpcProvider } = require('starknet');
const provider = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL });
const contract = new Contract(
  require('./contracts/EscrowABI.json'),
  process.env.ESCROW_CONTRACT_ADDRESS,
  provider
);
contract.get_platform_fee().then(fee => console.log('Platform fee:', fee));
"
```

---

## 📊 DEPLOYMENT SUMMARY

### Contract Addresses (Fill in after deployment)

```
EngiToken:       0x________________
EscrowV2:        0x________________
AtomiqAdapter:   0x________________
```

### Verification Links

```
EngiToken:       https://sepolia.voyager.online/contract/0x________________
EscrowV2:        https://sepolia.voyager.online/contract/0x________________
AtomiqAdapter:   https://sepolia.voyager.online/contract/0x________________
```

---

## 🎯 POST-DEPLOYMENT CHECKLIST

- [ ] All 3 contracts deployed successfully
- [ ] All contracts verified on Voyager/StarkScan
- [ ] Environment variables updated (frontend + backend)
- [ ] Contract calls tested and working
- [ ] Frontend can connect to contracts
- [ ] Backend can interact with contracts
- [ ] Demo script updated with contract addresses

---

## 🚨 TROUBLESHOOTING

### Compilation Errors
```bash
# Clear build cache
scarb clean
scarb build
```

### Deployment Fails
```bash
# Check account balance
starkli balance <YOUR_WALLET_ADDRESS> --rpc $STARKNET_RPC

# Check RPC connection
curl -X POST $STARKNET_RPC \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"starknet_chainId","params":[],"id":1}'
```

### Contract Not Found
- Wait 1-2 minutes for block confirmation
- Check transaction status on Voyager
- Verify you're using the correct network (Sepolia)

---

## ⏱️ TIME BREAKDOWN

| Task | Time | Status |
|------|------|--------|
| Install tools | 15 min | ⏳ |
| Setup project | 10 min | ⏳ |
| Compile contracts | 20 min | ⏳ |
| Setup wallet/RPC | 10 min | ⏳ |
| Deploy EngiToken | 30 min | ⏳ |
| Deploy EscrowV2 | 30 min | ⏳ |
| Deploy AtomiqAdapter | 30 min | ⏳ |
| Verify contracts | 30 min | ⏳ |
| Update env vars | 10 min | ⏳ |
| Test integration | 15 min | ⏳ |
| **TOTAL** | **3 hours** | ⏳ |

---

## 🎉 SUCCESS CRITERIA

✅ All 3 contracts deployed  
✅ All contracts verified on explorer  
✅ Frontend connects to contracts  
✅ Backend interacts with contracts  
✅ Demo ready with live contract addresses  

**You're ready for the hackathon demo! 🚀**
