#!/bin/bash

# EngiPay EscrowV2 Testnet Deployment Script
# Test deployment before mainnet

echo "🧪 EngiPay EscrowV2 Deployment to Testnet (Sepolia)"
echo "===================================================="
echo ""

# Check if sncast is installed
if ! command -v sncast &> /dev/null; then
    echo "❌ Error: sncast not found. Please install Starknet Foundry."
    echo "Visit: https://book.starknet.io/ch02-01-basic-installation.html"
    exit 1
fi

# Use the escrow-only configuration
echo "📝 Using optimized Scarb configuration..."
cp Scarb-escrow.toml Scarb.toml

# Compile the contract
echo "🔨 Compiling EscrowV2 contract..."
scarb build

if [ $? -ne 0 ]; then
    echo "❌ Compilation failed!"
    exit 1
fi

echo "✅ Compilation successful!"
echo ""

# Get deployment parameters
echo "📋 Deployment Parameters:"
echo "========================="
read -p "Enter owner address (your wallet): " OWNER_ADDRESS
read -p "Enter fee recipient address: " FEE_RECIPIENT
read -p "Enter platform fee (basis points, e.g., 100 = 1%): " PLATFORM_FEE

echo ""
echo "🔍 Review Parameters:"
echo "Owner: $OWNER_ADDRESS"
echo "Fee Recipient: $FEE_RECIPIENT"
echo "Platform Fee: $PLATFORM_FEE ($(echo "scale=2; $PLATFORM_FEE/100" | bc)%)"
echo ""

read -p "Proceed with deployment? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "❌ Deployment cancelled"
    exit 0
fi

echo ""
echo "🚀 Deploying to Sepolia Testnet..."
echo "💡 Get free testnet STRK: https://starknet-faucet.vercel.app/"
echo ""

# Deploy the contract
sncast deploy \
    --contract-name EscrowV2 \
    --network sepolia \
    --constructor-calldata "$OWNER_ADDRESS" "$FEE_RECIPIENT" "$PLATFORM_FEE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Testnet deployment successful!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Test all contract functions on testnet"
    echo "2. Verify gas costs are acceptable"
    echo "3. If everything works, deploy to mainnet: ./deploy-escrow-mainnet.sh"
else
    echo ""
    echo "❌ Deployment failed!"
    echo ""
    echo "💡 Get testnet STRK: https://starknet-faucet.vercel.app/"
fi
