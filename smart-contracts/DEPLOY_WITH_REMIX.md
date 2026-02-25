# Deploy EngiPay Contracts with Remix IDE (Easiest Method)

Since you're having network/RPC issues with starkli, use Remix IDE - it's browser-based and much simpler.

## Step 1: Prepare Your Contracts

Your contracts are already built! The compiled files are in:
- `target/dev/engipay_contracts_EngiToken.contract_class.json`
- `target/dev/engipay_contracts_EscrowV2.contract_class.json`

## Step 2: Open Starknet Remix

1. Go to: https://remix.ethereum.org/
2. Click "Plugin Manager" (plug icon on left)
3. Search for "Starknet" and activate it
4. Click the Starknet icon on the left sidebar

## Step 3: Connect Your Wallet

1. Install Argent X or Braavos wallet extension
2. Create/import a wallet
3. Get Sepolia testnet funds from: https://starknet-faucet.vercel.app/
4. In Remix, click "Connect Wallet"

## Step 4: Deploy EngiToken

1. In Remix Starknet plugin, click "Declare & Deploy"
2. Upload: `target/dev/engipay_contracts_EngiToken.contract_class.json`
3. Enter constructor parameters:
   - name: `EngiPay`
   - symbol: `ENGI`
   - initial_supply: `1000000000000000000000000` (1M tokens with 18 decimals)
   - owner: `YOUR_WALLET_ADDRESS`
4. Click "Declare" then "Deploy"
5. Copy the deployed contract address

## Step 5: Deploy EscrowV2

1. Click "Declare & Deploy" again
2. Upload: `target/dev/engipay_contracts_EscrowV2.contract_class.json`
3. Enter constructor parameters:
   - owner: `YOUR_WALLET_ADDRESS`
   - fee_recipient: `YOUR_WALLET_ADDRESS`
   - platform_fee: `250` (2.5%)
4. Click "Declare" then "Deploy"
5. Copy the deployed contract address

## Step 6: Save Addresses

Create a file `deployment-addresses.json`:

```json
{
  "network": "sepolia",
  "timestamp": "2026-02-23",
  "contracts": {
    "EngiToken": "0xYOUR_TOKEN_ADDRESS",
    "EscrowV2": "0xYOUR_ESCROW_ADDRESS"
  }
}
```

## Step 7: Verify on Starkscan

Visit:
- https://sepolia.starkscan.co/contract/YOUR_TOKEN_ADDRESS
- https://sepolia.starkscan.co/contract/YOUR_ESCROW_ADDRESS

Done! Your contracts are deployed!

## Alternative: Use Voyager

If Remix doesn't work, try Voyager:
1. Go to: https://sepolia.voyager.online/
2. Use their contract deployment interface
3. Upload your compiled JSON files

## Troubleshooting

- If wallet connection fails, refresh the page
- Make sure you're on Sepolia testnet in your wallet
- Ensure you have enough testnet ETH for gas fees
- If declare fails, the contract may already be declared - just deploy

