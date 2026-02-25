# Step-by-Step Deployment Guide

## What You've Done ✅
- ✅ Installed Scarb
- ✅ Built contracts successfully

## What's Missing ❌
- ❌ Starkli (deployment tool)
- ❌ Starknet wallet/account
- ❌ Testnet funds

---

## Step 1: Install Starkli

In your Ubuntu terminal, run:

```bash
# Install starkliup (installer)
curl https://get.starkli.sh | sh

# Restart your terminal or run:
source ~/.bashrc

# Install starkli
starkliup

# Verify installation:
starkli --version
```

---

## Step 2: Create a Starknet Account

### Option A: Use Argent X or Braavos Wallet (Easiest)

1. Install [Argent X](https://www.argent.xyz/argent-x/) or [Braavos](https://braavos.app/) browser extension
2. Create a wallet
3. Switch to **Sepolia Testnet**
4. Get testnet ETH from faucet: https://starknet-faucet.vercel.app/
5. Copy your wallet address

Then export your account:

```bash
# For Argent X:
starkli signer keystore from-key ~/.starkli-wallets/deployer/keystore.json

# Enter your private key when prompted
# (Get from Argent X: Settings > Account > Export Private Key)
```

### Option B: Create Account with Starkli (Alternative)

```bash
# Create keystore directory
mkdir -p ~/.starkli-wallets/deployer

# Generate a new signer
starkli signer keystore new ~/.starkli-wallets/deployer/keystore.json

# Create account descriptor
starkli account oz init ~/.starkli-wallets/deployer/account.json

# Get the computed address and fund it with testnet ETH
# Then deploy the account:
starkli account deploy ~/.starkli-wallets/deployer/account.json
```

---

## Step 3: Get Testnet Funds

Visit these faucets and paste your wallet address:

- **Starknet Sepolia Faucet**: https://starknet-faucet.vercel.app/
- **Blast Faucet**: https://blastapi.io/faucets/starknet-sepolia-eth
- **Alchemy Faucet**: https://www.alchemy.com/faucets/starknet-sepolia

You need at least **0.01 ETH** for deployment.

---

## Step 4: Set Up Environment Variables

```bash
# In your smart-contracts directory:
cd /mnt/c/Users/HP/engipay/smart-contracts

# Create .env file:
cat > .env << 'EOF'
STARKNET_NETWORK=sepolia
STARKNET_RPC=https://starknet-sepolia.public.blastapi.io/rpc/v0_7
STARKNET_ACCOUNT=~/.starkli-wallets/deployer/account.json
STARKNET_KEYSTORE=~/.starkli-wallets/deployer/keystore.json
EOF
```

---

## Step 5: Deploy Your Contracts

### Quick Deploy (All at Once):

```bash
# Make script executable:
chmod +x scripts/deploy-all.sh

# Run deployment:
./scripts/deploy-all.sh
```

### Manual Deploy (Step by Step):

```bash
# Set your account address (replace with your actual address):
export DEPLOYER_ADDRESS=0x1234...your_address

# 1. Declare EngiToken
starkli declare \
  target/dev/engipay_contracts_EngiToken.contract_class.json \
  --network sepolia \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --account ~/.starkli-wallets/deployer/account.json

# Save the class hash from output, then deploy:
starkli deploy \
  <CLASS_HASH_FROM_ABOVE> \
  --network sepolia \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --account ~/.starkli-wallets/deployer/account.json \
  str:"EngiPay Token" \
  str:"ENGI" \
  u256:1000000000000000000000000 \
  $DEPLOYER_ADDRESS

# 2. Declare and Deploy EscrowV2
starkli declare target/dev/engipay_contracts_EscrowV2.contract_class.json \
  --network sepolia \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --account ~/.starkli-wallets/deployer/account.json

starkli deploy \
  <ESCROW_CLASS_HASH> \
  --network sepolia \
  --keystore ~/.starkli-wallets/deployer/keystore.json \
  --account ~/.starkli-wallets/deployer/account.json \
  $DEPLOYER_ADDRESS \
  $DEPLOYER_ADDRESS \
  u256:250

# Repeat for other contracts...
```

---

## Common Errors & Solutions

### Error: "starkli: command not found"
**Solution**: Restart terminal after installing starkli, or run `source ~/.bashrc`

### Error: "Insufficient balance"
**Solution**: Get more testnet ETH from faucets listed above

### Error: "Account not deployed"
**Solution**: Deploy your account first with `starkli account deploy`

### Error: "Invalid class hash"
**Solution**: Make sure you declared the contract first before deploying

### Error: "RPC error"
**Solution**: Try a different RPC:
- `https://starknet-sepolia.public.blastapi.io/rpc/v0_7`
- `https://free-rpc.nethermind.io/sepolia-juno/v0_7`

---

## Verify Deployment

After deployment, verify on Starkscan:

https://sepolia.starkscan.co/contract/YOUR_CONTRACT_ADDRESS

---

## Next Steps After Deployment

1. Save all contract addresses
2. Update your `.env.local` file with addresses
3. Test contract interactions
4. Update frontend to use deployed contracts

---

## Need Help?

- Starknet Docs: https://docs.starknet.io/
- Starkli Docs: https://book.starkli.rs/
- Discord: https://discord.gg/starknet
