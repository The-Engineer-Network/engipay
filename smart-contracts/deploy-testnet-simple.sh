#!/bin/bash

# Simple Testnet Deployment
echo "🚀 Simple Testnet Deployment"
echo "=============================="

# Use the escrow-only configuration
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

# Deploy directly without account (uses wallet for signing)
echo "🚀 Deploying to Sepolia Testnet..."
echo "💡 Make sure you have testnet STRK in: 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431"
echo ""

sncast deploy \
    --contract-name EscrowV2 \
    --url https://starknet-sepolia.public.blastapi.io/rpc/v0_7 \
    --constructor-calldata 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431 100

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Deployment successful!"
else
    echo ""
    echo "❌ Deployment failed!"
    echo ""
    echo "💡 Alternative: Use Remix IDE"
    echo "1. Visit: https://remix.ethereum.org/"
    echo "2. Install Starknet plugin"
    echo "3. Deploy manually with your wallet"
fi
