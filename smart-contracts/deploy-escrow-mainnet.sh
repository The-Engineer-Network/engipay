#!/bin/bash

# EngiPay EscrowV2 Mainnet Deployment Script
# Optimized for minimal gas usage

echo "🚀 EngiPay EscrowV2 Deployment to Mainnet"
echo "=========================================="
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
echo "🚀 Deploying to Mainnet..."
echo "⚠️  This will use your STRK balance for gas fees"
echo ""

# Deploy the contract
sncast deploy \
    --contract-name EscrowV2 \
    --network mainnet \
    --constructor-calldata "$OWNER_ADDRESS" "$FEE_RECIPIENT" "$PLATFORM_FEE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "📝 Next steps:"
    echo "1. Save the contract address from above"
    echo "2. Update your .env files with the new address"
    echo "3. Verify the contract on StarkScan"
    echo "4. Test the contract functions"
else
    echo ""
    echo "❌ Deployment failed!"
    echo ""
    echo "💡 Troubleshooting:"
    echo "1. Check your STRK balance (need ~3-5 STRK)"
    echo "2. Verify your wallet is connected"
    echo "3. Check network connectivity"
    echo "4. Try deploying to testnet first: ./deploy-escrow-testnet.sh"
fi
