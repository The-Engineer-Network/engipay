# ✅ Contracts Successfully Compiled!

## Status: Ready for Deployment

All 3 core EngiPay smart contracts have been successfully compiled and are ready for deployment.

## Compiled Contracts

| Contract | Size | Purpose |
|----------|------|---------|
| **EngiToken** | 221KB | ERC20 token with minting capabilities |
| **EscrowV2** | 321KB | Payment request and escrow system |
| **AtomiqAdapter** | 312KB | Bitcoin/STRK swap integration |

## Files Location

```
smart-contracts/target/dev/
├── engipay_contracts_EngiToken.contract_class.json
├── engipay_contracts_EscrowV2.contract_class.json
└── engipay_contracts_AtomiqAdapter.contract_class.json
```

## Next Steps: Choose Your Deployment Method

### Method 1: Command Line (Starkli)

**Prerequisites:**
- Starknet wallet (Argent or Braavos)
- Testnet ETH for gas fees
- Account setup with starkli

**Steps:**
1. Setup account (see below)
2. Run deployment commands
3. Save contract addresses

### Method 2: Remix IDE (Easiest)

**Steps:**
1. Go to https://remix.ethereum.org/
2. Install Starknet plugin
3. Upload your contract files from `src/`
4. Compile and deploy via UI
5. No command line needed!

### Method 3: Starknet Foundry

**Steps:**
1. Use `snforge` for testing and deployment
2. More advanced but powerful
3. Good for CI/CD pipelines

## Account Setup (For Method 1)

### If You Have a Wallet:

```bash
# Fetch your existing wallet
starkli account fetch <YOUR_WALLET_ADDRESS> \
  --output ~/.starkli-wallets/account.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7

# Setup signer with your private key
starkli signer keystore from-key ~/.starkli-wallets/signer.json
```

### If You Need a New Wallet:

```bash
# Create new signer
starkli signer keystore new ~/.starkli-wallets/signer.json

# Initialize account
starkli account oz init ~/.starkli-wallets/account.json \
  --keystore ~/.starkli-wallets/signer.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7

# Deploy account (needs ETH)
starkli account deploy ~/.starkli-wallets/account.json \
  --keystore ~/.starkli-wallets/signer.json \
  --rpc https://starknet-sepolia.public.blastapi.io/rpc/v0_7
```

## Deployment Commands

Once account is setup, run:

```bash
# Set variables
ACCOUNT=~/.starkli-wallets/account.json
KEYSTORE=~/.starkli-wallets/signer.json
RPC=https://starknet-sepolia.public.blastapi.io/rpc/v0_7
OWNER=<YOUR_WALLET_ADDRESS>

# Deploy EngiToken
starkli deploy \
  target/dev/engipay_contracts_EngiToken.contract_class.json \
  --account $ACCOUNT \
  --keystore $KEYSTORE \
  --rpc $RPC \
  str:"EngiPay Token" \
  str:"ENGI" \
  u256:1000000000000000000000000 \
  $OWNER

# Deploy EscrowV2
starkli deploy \
  target/dev/engipay_contracts_EscrowV2.contract_class.json \
  --account $ACCOUNT \
  --keystore $KEYSTORE \
  --rpc $RPC \
  $OWNER \
  $OWNER \
  u256:250

# Deploy AtomiqAdapter
starkli deploy \
  target/dev/engipay_contracts_AtomiqAdapter.contract_class.json \
  --account $ACCOUNT \
  --keystore $KEYSTORE \
  --rpc $RPC \
  $OWNER \
  $OWNER \
  u256:100 \
  u64:86400
```

## Get Testnet ETH

You need Sepolia testnet ETH for gas fees:
- Faucet: https://starknet-faucet.vercel.app/
- Bridge: https://sepolia.starkgate.starknet.io/

## After Deployment

Save the contract addresses to your `.env` file:

```env
# Smart Contract Addresses (Sepolia Testnet)
ENGI_TOKEN_ADDRESS=0x...
ESCROW_CONTRACT_ADDRESS=0x...
ATOMIQ_ADAPTER_ADDRESS=0x...

# Network
STARKNET_NETWORK=sepolia
STARKNET_RPC_URL=https://starknet-sepolia.public.blastapi.io/rpc/v0_7
```

## Verify Deployments

Check on Starkscan:
- Sepolia: https://sepolia.starkscan.co/
- Search for your contract addresses
- Verify the code matches

## Contract Parameters

### EngiToken
- Name: "EngiPay Token"
- Symbol: "ENGI"
- Initial Supply: 1,000,000 tokens (1000000000000000000000000 wei)
- Decimals: 18

### EscrowV2
- Platform Fee: 2.5% (250 basis points)
- Owner: Your wallet address
- Fee Recipient: Your wallet address

### AtomiqAdapter
- Swap Fee: 1% (100 basis points)
- Timeout: 24 hours (86400 seconds)
- Owner: Your wallet address

## Troubleshooting

### "Account not found"
- Make sure you've run the account setup commands
- Check that files exist in `~/.starkli-wallets/`

### "Insufficient funds"
- Get testnet ETH from the faucet
- Check balance: `starkli balance <YOUR_ADDRESS>`

### "Invalid constructor arguments"
- Make sure addresses are in correct format (0x...)
- Use `str:` prefix for strings
- Use `u256:` prefix for large numbers
- Use `u64:` prefix for timestamps

## What's Next?

1. ✅ Contracts compiled
2. ⏳ Setup account
3. ⏳ Deploy contracts
4. ⏳ Update .env file
5. ⏳ Test contract interactions
6. ⏳ Integrate with frontend

## Need Help?

- Starknet Docs: https://docs.starknet.io/
- Starkli Docs: https://book.starkli.rs/
- Cairo Book: https://book.cairo-lang.org/
- Discord: https://discord.gg/starknet

---

**You're 90% there!** Just need to setup your account and run the deployment commands.
