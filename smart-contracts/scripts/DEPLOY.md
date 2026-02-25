# Deploy Your Contracts

## Issue
The starknet.js v6.11.0 has a bug with Account initialization that's preventing deployment via Node.js scripts.

## Solution: Use Starkli (Command Line)

### Step 1: Install Starkli
```bash
curl https://get.starkli.sh | sh
starkliup
```

### Step 2: Set Environment Variables
```bash
export STARKNET_ACCOUNT=~/.starkli-wallets/deployer/account.json
export STARKNET_KEYSTORE=~/.starkli-wallets/deployer/keystore.json  
export STARKNET_RPC=https://starknet-sepolia.public.blastapi.io/rpc/v0_7
```

### Step 3: Deploy Contracts

```bash
cd smart-contracts

# Deploy EngiToken
starkli deploy \
  target/dev/engipay_contracts_EngiToken.contract_class.json \
  str:EngiPay \
  str:ENGI \
  u256:1000000000000000000000000 \
  0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431

# Deploy EscrowV2
starkli deploy \
  target/dev/engipay_contracts_EscrowV2.contract_class.json \
  0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431 \
  0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431 \
  u256:250

# Deploy AtomiqAdapter
starkli deploy \
  target/dev/engipay_contracts_AtomiqAdapter.contract_class.json \
  0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431 \
  0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431 \
  u256:50 \
  u64:86400
```

## Alternative: Use Remix IDE

1. Go to https://remix.ethereum.org/
2. Install Starknet plugin
3. Upload your Cairo contracts
4. Compile and deploy via UI

## The Real Solution

The testnet RPC issues and starknet.js v6 bugs are blocking us. The best path forward is to either:

1. Wait for testnet RPCs to stabilize
2. Get mainnet tokens to deploy there
3. Use Remix IDE for deployment
4. Upgrade to starknet.js v9 (but this might break other dependencies)

Your contracts are ready and compiled. It's just the deployment tooling that's problematic right now.
