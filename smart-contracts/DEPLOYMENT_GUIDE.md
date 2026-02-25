# EngiPay Smart Contract Deployment Guide

## Quick Fix Summary

Your deployment was failing because:
1. The script was using a hardcoded wallet address that doesn't have your STRK tokens
2. The RPC endpoint was unreachable (DNS error)

## ✅ Fixed Issues

1. Updated `deploy.sh` to use YOUR wallet address from `.env.local`:
   - `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`

2. Changed RPC endpoint to Lava (more reliable):
   - `https://rpc.starknet.lava.build`

3. Created setup scripts for both Linux/Mac and Windows

## 🚀 Deployment Steps

### For Linux/Mac (WSL/Bash):

```bash
cd smart-contracts

# Step 1: Setup your wallet (one-time)
chmod +x setup-wallet.sh
./setup-wallet.sh

# Step 2: Build contracts
scarb build

# Step 3: Deploy
chmod +x deploy.sh
./deploy.sh
```

### For Windows (CMD/PowerShell):

```cmd
cd smart-contracts

REM Step 1: Setup your wallet (one-time)
setup-wallet.bat

REM Step 2: Build contracts
scarb build

REM Step 3: Deploy
deploy.bat
```

## 📝 What the Setup Script Does

The `setup-wallet` script will:
1. Create `~/.starkli-wallets/` directory
2. Create a signer keystore from your private key
3. Fetch your account configuration from the network
4. Check your STRK balance

You'll be prompted to enter a password to encrypt your keystore file. Remember this password - you'll need it for deployment!

## 🔑 Important Notes

1. **Keystore Password**: When running `setup-wallet`, you'll create a password. Use the same password when deploying.

2. **STRK Balance**: Make sure you have enough STRK tokens for:
   - Declaring 3 contracts (~0.01 STRK each)
   - Deploying 3 contracts (~0.01 STRK each)
   - Total needed: ~0.06 STRK

3. **RPC Alternatives**: If Lava RPC doesn't work, the script includes alternatives:
   - Blast API: `https://starknet-sepolia.public.blastapi.io/rpc/v0_7`
   - Nethermind: `https://free-rpc.nethermind.io/sepolia-juno`

## 🎯 After Deployment

Once deployment succeeds, you'll get a `deployment-addresses.json` file with your contract addresses.

Update your `.env.local`:
```env
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=<EngiToken address>
NEXT_PUBLIC_ESCROW_ADDRESS=<EscrowV2 address>
NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=<AtomiqAdapter address>
```

Update your `backend/.env`:
```env
ENGI_TOKEN_ADDRESS=<EngiToken address>
ESCROW_CONTRACT_ADDRESS=<EscrowV2 address>
ATOMIQ_ADAPTER_ADDRESS=<AtomiqAdapter address>
```

## 🔍 Troubleshooting

### "DNS error: failed to lookup address"
- Try a different RPC endpoint (see alternatives above)
- Check your internet connection

### "Insufficient balance"
- Get testnet STRK from: https://starknet-faucet.vercel.app/
- Or: https://blastapi.io/faucets/starknet-sepolia-eth

### "Account not found"
- Run `setup-wallet` script first
- Make sure your wallet is deployed on Sepolia testnet

### "Invalid signature"
- Your private key might be incorrect
- Check `.env.local` for the correct private key
- Re-run `setup-wallet` script

## 📚 Contract Details

### EngiToken
- ERC20 token for the EngiPay ecosystem
- Initial supply: 1,000,000 ENGI
- Minted to deployer address

### EscrowV2
- Handles secure payment escrow
- Fee: 2.5% (250 basis points)
- Owner: Your wallet address

### AtomiqAdapter
- Integrates with Atomiq for cross-chain swaps
- Fee: 1% (100 basis points)
- Timeout: 24 hours (86400 seconds)

## 🌐 Network Information

- Network: Starknet Sepolia Testnet
- Chain ID: SN_SEPOLIA
- Explorer: https://sepolia.starkscan.co
- Faucet: https://starknet-faucet.vercel.app/

## 💡 Tips

1. Keep your `deployment-addresses.json` file safe
2. Verify contracts on Starkscan after deployment
3. Test each contract before using in production
4. Never commit your private keys to git

## 🆘 Need Help?

If you encounter issues:
1. Check the error message carefully
2. Verify your STRK balance
3. Try a different RPC endpoint
4. Make sure starkli and scarb are up to date:
   ```bash
   starkliup
   ```
