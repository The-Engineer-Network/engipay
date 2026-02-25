#!/bin/bash

echo "🚀 Full Optimized EscrowV2 Deployment"
echo "======================================"
echo "Includes: Platform fees, Fee recipient, Expiry, Pause, All features"
echo "Optimized: No SafeMath, Memo in events only, Cached reads"
echo ""

# Use the optimized escrow configuration
cp Scarb-escrow.toml Scarb.toml

# Clean and rebuild
echo "🧹 Cleaning old builds..."
rm -rf target/

echo "🔨 Compiling full optimized EscrowV2..."
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
read -p "Enter owner address: " OWNER_ADDRESS
read -p "Enter fee recipient address: " FEE_RECIPIENT
read -p "Enter platform fee (basis points, e.g., 100 = 1%): " PLATFORM_FEE

echo ""
echo "🔍 Review Parameters:"
echo "Owner: $OWNER_ADDRESS"
echo "Fee Recipient: $FEE_RECIPIENT"
echo "Platform Fee: $PLATFORM_FEE ($(echo "scale=2; $PLATFORM_FEE/100" | bc)%)"
echo ""
echo "📊 Estimated Cost: 3-4 STRK"
echo "💰 Your Balance: Should have 5+ STRK"
echo ""

read -p "Proceed with deployment? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "❌ Deployment cancelled"
    exit 0
fi

echo ""
echo "🚀 Deploying to Mainnet..."
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
    echo "1. Copy the contract address from above"
    echo "2. Update backend/.env: ESCROW_CONTRACT_ADDRESS=0x..."
    echo "3. Update .env.local: NEXT_PUBLIC_ESCROW_ADDRESS=0x..."
    echo "4. Verify on StarkScan: https://starkscan.co/contract/YOUR_ADDRESS"
    echo "5. Test the contract functions"
else
    echo ""
    echo "❌ Deployment failed!"
    echo ""
    echo "💡 Check your STRK balance and try again"
fi
