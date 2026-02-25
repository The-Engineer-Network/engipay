# Deploy EngiPay Contracts Using Remix IDE

Since you're having DNS/network issues with starkli, let's use Remix IDE instead - it's browser-based and much simpler!

## 🚀 Quick Steps

### 1. Build Your Contracts First

```bash
cd /mnt/c/Users/HP/engipay/smart-contracts
scarb build
```

This creates the compiled contract files in `target/dev/`

### 2. Open Remix IDE

Go to: **https://remix.ethereum.org/**

### 3. Install Starknet Plugin

1. Click the **Plugin Manager** icon (plug icon on left sidebar)
2. Search for **"Starknet"**
3. Click **Activate** on the Starknet plugin
4. The Starknet icon will appear in the left sidebar

### 4. Connect Your Wallet

1. Click the **Starknet** icon in the left sidebar
2. Click **Connect Wallet**
3. Choose **ArgentX** or **Braavos** (whichever you use)
4. Make sure you're on **Sepolia Testnet**
5. Your wallet address should show: `0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d`

### 5. Create Contract Files in Remix

You need to copy your Cairo source files to Remix:

#### Option A: Upload Files (Easiest)
1. In Remix, click **File Explorer** (top left)
2. Right-click in the file explorer → **New Folder** → name it `engipay`
3. Upload these files from your `smart-contracts/src/` directory:
   - `EngiToken.cairo`
   - `EscrowV2.cairo`
   - `adapters/AtomiqAdapter.cairo`
   - `interfaces/IERC20.cairo`
   - `libraries/SafeMath.cairo`

#### Option B: Copy-Paste
1. Create the folder structure in Remix
2. Copy the content of each `.cairo` file and paste into Remix

### 6. Compile Contracts

1. Click the **Starknet** plugin icon
2. Select **Compiler** tab
3. For each contract:
   - Select the contract file (e.g., `EngiToken.cairo`)
   - Click **Compile**
   - Wait for "Compilation successful" message

### 7. Deploy EngiToken

1. In Starknet plugin, go to **Deploy** tab
2. Select **EngiToken** from dropdown
3. Fill in constructor parameters:
   ```
   name: EngiPay Token
   symbol: ENGI
   initial_supply: 1000000000000000000000000
   recipient: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
   ```
4. Click **Deploy**
5. Approve transaction in your wallet
6. **SAVE THE CONTRACT ADDRESS** - you'll need it!

### 8. Deploy EscrowV2

1. Select **EscrowV2** from dropdown
2. Fill in constructor parameters:
   ```
   owner: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
   fee_recipient: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
   fee_basis_points: 250
   ```
3. Click **Deploy**
4. Approve transaction in your wallet
5. **SAVE THE CONTRACT ADDRESS**

### 9. Deploy AtomiqAdapter

1. Select **AtomiqAdapter** from dropdown
2. Fill in constructor parameters:
   ```
   owner: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
   fee_recipient: 0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
   fee_basis_points: 100
   swap_timeout: 86400
   ```
3. Click **Deploy**
4. Approve transaction in your wallet
5. **SAVE THE CONTRACT ADDRESS**

### 10. Update Your Environment Files

Once all contracts are deployed, update your `.env.local`:

```env
NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=<EngiToken address from step 7>
NEXT_PUBLIC_ESCROW_ADDRESS=<EscrowV2 address from step 8>
NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=<AtomiqAdapter address from step 9>
```

And `backend/.env`:

```env
ENGI_TOKEN_ADDRESS=<EngiToken address>
ESCROW_CONTRACT_ADDRESS=<EscrowV2 address>
ATOMIQ_ADAPTER_ADDRESS=<AtomiqAdapter address>
```

## 📝 Important Notes

### Constructor Parameter Types

When entering values in Remix:

- **Strings** (name, symbol): Just type the text
- **u256** (large numbers): Enter the full number
- **Addresses**: Must start with `0x`
- **u64** (timeout): Enter as regular number (86400)

### Initial Supply Breakdown

`1000000000000000000000000` = 1,000,000 tokens with 18 decimals
- This is: 1,000,000 × 10^18

### Fee Basis Points

- 250 basis points = 2.5% fee (for Escrow)
- 100 basis points = 1% fee (for AtomiqAdapter)

## ✅ Advantages of Using Remix

1. **No CLI issues** - Everything in browser
2. **No DNS problems** - Uses your wallet's RPC
3. **Visual interface** - Easier to see what you're doing
4. **Transaction history** - Can see all deployments
5. **Wallet integration** - Direct connection to ArgentX/Braavos

## 🔍 Verify Deployments

After deployment, check your contracts on Starkscan:

```
https://sepolia.starkscan.co/contract/<YOUR_CONTRACT_ADDRESS>
```

## 🆘 Troubleshooting

### "Compilation failed"
- Make sure all imported files are in Remix
- Check that file paths in imports match your folder structure

### "Transaction failed"
- Check you have enough STRK for gas
- Make sure you're on Sepolia testnet
- Verify constructor parameters are correct

### "Wallet not connected"
- Refresh Remix page
- Reconnect wallet
- Make sure wallet is on Sepolia network

## 💡 Pro Tips

1. **Test on Sepolia first** - Never deploy to mainnet without testing
2. **Save addresses immediately** - Write them down as you deploy
3. **Verify on Starkscan** - Check each contract after deployment
4. **Small amounts first** - Test with small transactions before going big

## 🎯 Next Steps After Deployment

1. ✅ Update environment variables
2. ✅ Verify contracts on Starkscan
3. ✅ Test token transfers
4. ✅ Test escrow functionality
5. ✅ Test Atomiq adapter
6. ✅ Update frontend to use new addresses
7. ✅ Run integration tests

---

**Need the faucet?**
- Starknet Sepolia Faucet: https://starknet-faucet.vercel.app/
- Blast Faucet: https://blastapi.io/faucets/starknet-sepolia-eth
