# 🚀 StarkNet Smart Contract Deployment Guide

This guide provides step-by-step instructions for deploying your EngiPay smart contracts to StarkNet mainnet.

## 📋 Prerequisites

### 1. **StarkNet Account Setup**
You need a StarkNet account with ETH for gas fees:

```bash
# Install StarkNet wallet (ArgentX, Braavos, etc.)
# Fund your account with ETH on StarkNet
# Get your private key and account address
```

### 2. **Development Environment**
```bash
# Install Node.js 18+
node --version

# Install StarkNet CLI tools
npm install -g @starknet-foundry/starknet-foundry

# Verify installation
starknet --version
```

### 3. **Project Setup**
```bash
cd smart-contracts

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your values
nano .env
```

## 🔧 Environment Configuration

Edit `smart-contracts/.env`:

```env
# Network (use 'sepolia' for testing first)
STARKNET_NETWORK=sepolia

# Your StarkNet account details
DEPLOYER_PRIVATE_KEY=0x_your_private_key_here
DEPLOYER_ADDRESS=0x_your_account_address_here

# Contract parameters
ENGI_TOKEN_NAME=EngiToken
ENGI_TOKEN_SYMBOL=ENGI
ENGI_INITIAL_SUPPLY=1000000
PLATFORM_FEE_BASIS_POINTS=50
REWARD_RATE_PER_SECOND=1000000000000000000
```

## 🏗️ Contract Compilation

### 1. **Compile Contracts**
```bash
# Compile all contracts
npm run compile

# Or compile individually
starknet-compile contracts/EngiToken.cairo --output artifacts/EngiToken.json
starknet-compile contracts/Escrow.cairo --output artifacts/Escrow.json
starknet-compile contracts/RewardDistributor.cairo --output artifacts/RewardDistributor.json
```

### 2. **Verify Compilation**
```bash
# Check artifacts directory
ls -la artifacts/

# Should contain:
# - EngiToken.contract_class.json
# - EngiToken.compiled_contract_class.json
# - Escrow.contract_class.json
# - Escrow.compiled_contract_class.json
# - RewardDistributor.contract_class.json
# - RewardDistributor.compiled_contract_class.json
```

## 🚀 Deployment Process

### **Step 1: Test on Sepolia (Recommended)**
```bash
# Deploy to testnet first
npm run deploy:sepolia

# Or manually
STARKNET_NETWORK=sepolia node scripts/deploy.js
```

### **Step 2: Verify Testnet Deployment**
```bash
# Check deployments.json
cat deployments.json

# Verify on StarkNet explorer
# https://sepolia.starkscan.co/
```

### **Step 3: Deploy to Mainnet**
```bash
# Switch to mainnet
STARKNET_NETWORK=mainnet node scripts/deploy.js
```

## 📊 Deployment Output

After successful deployment, you'll get:

```
🎉 Deployment completed successfully!

📋 Contract Addresses:
   EngiToken: 0x0123...abcd
   Escrow: 0x0456...efgh
   RewardDistributor: 0x0789...ijkl

📝 Update your .env.local file with these addresses:
ENGI_TOKEN_CONTRACT=0x0123...abcd
ESCROW_CONTRACT=0x0456...efgh
REWARD_DISTRIBUTOR_CONTRACT=0x0789...ijkl
```

## 🔄 Update Application Configuration

### 1. **Update Frontend Environment**
Edit your main `.env.local`:

```env
# Smart Contract Addresses (StarkNet)
ENGI_TOKEN_CONTRACT=0x0123...abcd
ESCROW_CONTRACT=0x0456...efgh
REWARD_DISTRIBUTOR_CONTRACT=0x0789...ijkl

# StarkNet Configuration
STARKNET_RPC_URL=https://starknet-mainnet.public.blastapi.io
STARKNET_CHAIN_ID=0x534e5f4d41494e
```

### 2. **Install Frontend Dependencies**
```bash
# Install StarkNet libraries
npm install starknet get-starknet

# For React hooks (optional)
npm install @starknet-react/core
```

### 3. **Update Backend Configuration**
Your backend is already configured to work with the contracts.

## 🧪 Testing Deployment

### **1. Verify Contracts on StarkScan**
```
Mainnet: https://starkscan.co/
Sepolia: https://sepolia.starkscan.co/
```

### **2. Test Contract Interactions**
```bash
# Test ENGI token
# - Check total supply
# - Check your balance
# - Test transfers

# Test Escrow
# - Create payment request
# - Accept payment
# - Check status

# Test Reward Distributor
# - Check pool info
# - Stake tokens
# - Claim rewards
```

### **3. Test Frontend Integration**
```bash
# Start your application
npm run dev

# Test features:
# - Connect StarkNet wallet
# - View ENGI balance
# - Create escrow payments
# - Stake/unstake tokens
# - Claim rewards
```

## 🛠️ Troubleshooting

### **Common Issues:**

#### **1. Insufficient Funds**
```
Error: Insufficient account balance
```
**Solution:** Fund your StarkNet account with ETH for gas fees.

#### **2. Wrong Network**
```
Error: Chain ID mismatch
```
**Solution:** Ensure STARKNET_NETWORK matches your target network.

#### **3. Compilation Errors**
```
Error: Compilation failed
```
**Solution:** Check Cairo syntax and ensure all dependencies are installed.

#### **4. Declaration Failed**
```
Error: Declaration rejected
```
**Solution:** Contract might already be declared. Check class hash.

### **Debug Commands:**
```bash
# Check account balance
starknet get_nonce --address $DEPLOYER_ADDRESS

# Estimate fee
starknet estimate_fee --contract artifacts/EngiToken.json

# Get transaction status
starknet get_transaction_receipt --hash 0x...
```

## 📋 Deployment Checklist

- [ ] **Environment Setup**
  - [ ] Node.js 18+ installed
  - [ ] StarkNet CLI installed
  - [ ] Wallet funded with ETH
  - [ ] Private key and address configured

- [ ] **Contract Compilation**
  - [ ] All contracts compile successfully
  - [ ] Artifacts generated in `/artifacts`
  - [ ] ABI files extracted

- [ ] **Testnet Deployment**
  - [ ] Deploy to Sepolia first
  - [ ] Verify contracts on explorer
  - [ ] Test basic functionality
  - [ ] Confirm gas costs

- [ ] **Mainnet Deployment**
  - [ ] Backup wallet/private keys
  - [ ] Deploy contracts
  - [ ] Save deployment addresses
  - [ ] Verify on StarkScan

- [ ] **Application Integration**
  - [ ] Update `.env.local` with addresses
  - [ ] Install StarkNet dependencies
  - [ ] Test frontend integration
  - [ ] Verify backend API calls

## 🔒 Security Considerations

### **Before Mainnet Deployment:**
- [ ] **Audit Contracts**: Get professional security audit
- [ ] **Test Thoroughly**: Test all functions on testnet
- [ ] **Backup Keys**: Secure private keys and mnemonics
- [ ] **Verify Addresses**: Double-check all contract addresses
- [ ] **Gas Estimation**: Ensure sufficient funds for deployment

### **Post-Deployment:**
- [ ] **Monitor Contracts**: Watch for unusual activity
- [ ] **Backup Data**: Save deployment logs and addresses
- [ ] **Document**: Keep records of all transactions
- [ ] **Emergency Plans**: Have contract pause/upgrade plans

## 📞 Support

If you encounter issues:

1. **Check Logs**: Review deployment script output
2. **Verify Configuration**: Ensure all environment variables are set
3. **Test Network**: Try Sepolia first if mainnet fails
4. **Community**: Check StarkNet Discord for help
5. **Documentation**: Refer to StarkNet official docs

## 🎯 Next Steps

After successful deployment:

1. **Launch Application**: Start your EngiPay platform
2. **User Testing**: Have users test all features
3. **Monitor Usage**: Track contract interactions
4. **Gather Feedback**: Improve based on user experience
5. **Scale**: Add more features and integrations

---

**Happy deploying! 🚀**