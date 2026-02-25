#!/bin/bash

echo "🚀 ULTRA-MINIMAL Escrow Deployment"
echo "===================================="
echo "This is the absolute smallest escrow contract possible"
echo "Removed: fees, expiry, pause, all extras"
echo "Kept: create, accept, cancel"
echo ""

cp Scarb-minimal.toml Scarb.toml

echo "🔨 Compiling minimal contract..."
scarb build

if [ $? -ne 0 ]; then
    echo "❌ Compilation failed!"
    exit 1
fi

echo "✅ Compiled!"
echo ""
echo "📊 Estimated gas: ~400-500K units (down from 920K)"
echo "💰 Estimated cost: ~2-2.5 STRK"
echo ""

read -p "Deploy to mainnet? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    exit 0
fi

sncast deploy \
    --contract-name EscrowMinimal \
    --network mainnet \
    --constructor-calldata 0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431

if [ $? -eq 0 ]; then
    echo "✅ SUCCESS! Deployed with 3 STRK!"
else
    echo "❌ Still not enough. You need to buy more STRK."
fi
