# Web-Based Deployment (Alternative to CLI)

## Issue
Your private key format is incompatible with starkli's keystore system.

## Solution: Deploy via Web Interface

### Option 1: Remix IDE (Recommended)

1. **Go to Remix:** https://remix.ethereum.org/

2. **Install Starknet Plugin:**
   - Click Plugin Manager
   - Search "Starknet"
   - Install it

3. **Upload Contract Files:**
   - Upload from `smart-contracts/src/`:
     - `EngiToken.cairo`
     - `EscrowV2.cairo`
     - `AtomiqAdapter.cairo`
   - Also upload dependencies:
     - `interfaces/IERC20.cairo`
     - `libraries/SafeMath.cairo`

4. **Connect Wallet:**
   - Use Argent or Braavos browser extension
   - Connect to Sepolia testnet

5. **Compile:**
   - Select each contract
   - Click "Compile"

6. **Deploy:**
   - Select compiled contract
   - Enter constructor parameters
   - Click "Deploy"

### Option 2: Voyager Deploy

1. **Go to:** https://voyager.online/
2. **Click "Deploy Contract"**
3. **Upload compiled JSON** from `target/dev/`
4. **Connect wallet and deploy**

### Option 3: Use Starknet.js Script

Create a deployment script using your wallet directly:

```javascript
// deploy.js
const { Account, Contract, RpcProvider } = require('starknet');

const provider = new RpcProvider({
  nodeUrl: 'https://starknet-sepolia.public.blastapi.io/rpc/v0_7'
});

const account = new Account(
  provider,
  '0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431',
  '0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a'
);

// Deploy contracts here
```

## Your Compiled Contracts

Located in: `smart-contracts/target/dev/`

1. **engipay_contracts_EngiToken.contract_class.json** (221KB)
2. **engipay_contracts_EscrowV2.contract_class.json** (321KB)
3. **engipay_contracts_AtomiqAdapter.contract_class.json** (312KB)

## Constructor Parameters

### EngiToken
```
name: "EngiPay Token"
symbol: "ENGI"
initial_supply: 1000000000000000000000000
owner: 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431
```

### EscrowV2
```
owner: 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431
fee_recipient: 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431
platform_fee: 250
```

### AtomiqAdapter
```
owner: 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431
fee_recipient: 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431
platform_fee: 100
swap_timeout: 86400
```

## After Deployment

Update `.env.local`:
```env
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=<deployed_address>
NEXT_PUBLIC_ESCROW_ADDRESS=<deployed_address>
NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=<deployed_address>
```

## Why This Happened

The private key in your `.env.local` might be:
- From a different wallet type
- In wrong format for starkli
- Needs different encoding

Web interfaces handle this automatically by using your browser wallet.
