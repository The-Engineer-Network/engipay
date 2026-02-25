# Error Report - Starknet Deployment Issue

## Issue Summary
Getting `TypeError: Cannot read properties of undefined (reading 'toLowerCase')` when trying to create Account object with starknet.js v6.11.0

## What I Tried

### 1. Multiple RPC Providers (All Failed)
- ❌ Lava: `https://rpc.starknet.lava.build`
- ❌ Blast API: `https://starknet-sepolia.public.blastapi.io/rpc/v0_7`
- ❌ Nethermind: `https://free-rpc.nethermind.io/sepolia-juno/v0_7`
- ❌ Alchemy: `https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/[API_KEY]`

### 2. Faucets (Not Working)
- ❌ https://starknet-faucet.vercel.app - Not dispensing tokens
- ❌ https://faucet.goerli.starknet.io/ - Down/not working

## Exact Error

```javascript
// Code
const { Account, RpcProvider } = require("starknet");

const provider = new RpcProvider({ 
  nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7" 
});

const account = new Account(
  provider, 
  "0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431",
  "0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a",
  "1"
);

// Error
TypeError: Cannot read properties of undefined (reading 'toLowerCase')
    at new Account (C:\Users\HP\engipay\node_modules\starknet\dist\index.js:11252:28)
```

## Environment

**Starknet.js Version:** v6.11.0 (also have v9.2.1 in some dependencies)

**Node.js:** v20.11.1

**OS:** Windows 11

**Network:** Sepolia testnet

**Wallet:** Argent (Sepolia)

## What I've Verified

✅ Wallet address is correct (starts with 0x)
✅ Private key is correct (starts with 0x)
✅ Both are strings
✅ RPC URLs are correct for Sepolia
✅ Contracts are compiled successfully
✅ Using correct Account constructor signature for v6

## Dependency Conflict?

I have multiple versions of starknet.js:
- Main: v6.11.0
- Some packages use: v9.2.1, v8.5.4, v8.9.2

Could this be causing the issue?

## Question

Should I:
1. Upgrade to starknet.js v9 or v10?
2. Use a different RPC provider?
3. Is there a known issue with Account initialization in v6.11.0?
4. Do I need to use a different account creation method?

## What Works

✅ Frontend wallet connections (ArgentX, Braavos)
✅ Transaction signing in browser
✅ All other features (Atomiq swaps, Tongo privacy, DeFi)

Only issue is deploying contracts via Node.js script.

## Temporary Workaround Attempted

Tried using StarkZap SDK but it requires ESM modules which conflicts with our CommonJS setup.

---

**Need help with:**
1. Correct way to create Account in starknet.js v6/v9/v10
2. Which RPC provider is most reliable for Sepolia
3. How to get testnet tokens (faucets not working)
