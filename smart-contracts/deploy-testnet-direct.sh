#!/bin/bash

# Direct Testnet Deployment - Uses Declarative Deployment
echo "🚀 Direct Testnet Deployment"
echo "=============================="

# Use the escrow-only configuration
echo "📝 Using optimized Scarb configuration..."
cp Scarb-escrow.toml Scarb.toml

# Compile
echo "🔨 Compiling..."
scarb build

if [ $? -ne 0 ]; then
    echo "❌ Compilation failed!"
    exit 1
fi

echo "✅ Compilation successful!"
echo ""

# Deploy using declarative deployment (no account needed)
echo "🚀 Deploying to Sepolia Testnet..."
echo ""

# Constructor calldata
OWNER="0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431"
FEE_RECIPIENT="0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431"
PLATFORM_FEE="100"

echo "📋 Deployment Parameters:"
echo "Owner: $OWNER"
echo "Fee Recipient: $FEE_RECIPIENT"
echo "Platform Fee: $PLATFORM_FEE"
echo ""

# Declare the contract first
echo "📤 Declaring contract..."
sncast --url https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
    declare \
    --contract-name EscrowV2

echo ""
echo "✅ If declaration succeeded, copy the class hash above"
echo "Then deploy using:"
echo ""
echo "sncast --url https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \\"
echo "    deploy \\"
echo "    --class-hash YOUR_CLASS_HASH \\"
echo "    --constructor-calldata $OWNER $FEE_RECIPIENT $PLATFORM_FEE"
