#!/bin/bash

# EngiPay - Deploy with Starkli (Works with any Node version!)
# This uses starkli CLI instead of Node.js

echo "🚀 EngiPay Deployment with Starkli"
echo "===================================="
echo ""

# Your wallet details
WALLET_ADDRESS="0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431"
NETWORK="sepolia"

# RPC URL
RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/Dij4b08u9UCGvFQ6sfgDP"

echo "Network: $NETWORK"
echo "Wallet: $WALLET_ADDRESS"
echo "RPC: $RPC_URL"
echo ""

# Check if starkli is installed
if ! command -v starkli &> /dev/null; then
    echo "❌ Starkli not found!"
    echo "Install with: curl https://get.starkli.sh | sh"
    echo "Then run: starkliup"
    exit 1
fi

echo "✅ Starkli found"
echo ""

# Set environment
export STARKNET_RPC=$RPC_URL

# Navigate to contracts directory
cd "$(dirname "$0")/.."

# Check if contracts are compiled
if [ ! -d "target/dev" ]; then
    echo "❌ Contracts not compiled!"
    echo "Run: scarb build"
    exit 1
fi

echo "✅ Contracts compiled"
echo ""

# Deploy EngiToken
echo "🚀 Deploying EngiToken..."
echo "Declaring class..."

ENGI_CLASS_HASH=$(starkli declare target/dev/engipay_contracts_EngiToken.contract_class.json --rpc $RPC_URL 2>&1 | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ENGI_CLASS_HASH" ]; then
    echo "❌ Failed to declare EngiToken"
    exit 1
fi

echo "✅ EngiToken class hash: $ENGI_CLASS_HASH"

echo "Deploying contract..."
ENGI_ADDRESS=$(starkli deploy $ENGI_CLASS_HASH \
    str:EngiPay \
    str:ENGI \
    u256:1000000000000000000000000 \
    $WALLET_ADDRESS \
    --rpc $RPC_URL 2>&1 | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ENGI_ADDRESS" ]; then
    echo "❌ Failed to deploy EngiToken"
    exit 1
fi

echo "✅ EngiToken deployed: $ENGI_ADDRESS"
echo ""

# Deploy EscrowV2
echo "🚀 Deploying EscrowV2..."
ESCROW_CLASS_HASH=$(starkli declare target/dev/engipay_contracts_EscrowV2.contract_class.json --rpc $RPC_URL 2>&1 | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

echo "✅ EscrowV2 class hash: $ESCROW_CLASS_HASH"

ESCROW_ADDRESS=$(starkli deploy $ESCROW_CLASS_HASH \
    $WALLET_ADDRESS \
    $WALLET_ADDRESS \
    u256:250 \
    --rpc $RPC_URL 2>&1 | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

echo "✅ EscrowV2 deployed: $ESCROW_ADDRESS"
echo ""

# Deploy AtomiqAdapter
echo "🚀 Deploying AtomiqAdapter..."
ATOMIQ_CLASS_HASH=$(starkli declare target/dev/engipay_contracts_AtomiqAdapter.contract_class.json --rpc $RPC_URL 2>&1 | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

echo "✅ AtomiqAdapter class hash: $ATOMIQ_CLASS_HASH"

ATOMIQ_ADDRESS=$(starkli deploy $ATOMIQ_CLASS_HASH \
    $WALLET_ADDRESS \
    $WALLET_ADDRESS \
    u256:50 \
    u64:86400 \
    --rpc $RPC_URL 2>&1 | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

echo "✅ AtomiqAdapter deployed: $ATOMIQ_ADDRESS"
echo ""

# Summary
echo "===================================="
echo "🎉 DEPLOYMENT COMPLETE!"
echo "===================================="
echo ""
echo "📋 Contract Addresses:"
echo "EngiToken:       $ENGI_ADDRESS"
echo "EscrowV2:        $ESCROW_ADDRESS"
echo "AtomiqAdapter:   $ATOMIQ_ADDRESS"
echo ""
echo "🔗 Voyager Links:"
echo "https://sepolia.voyager.online/contract/$ENGI_ADDRESS"
echo "https://sepolia.voyager.online/contract/$ESCROW_ADDRESS"
echo "https://sepolia.voyager.online/contract/$ATOMIQ_ADDRESS"
echo ""
echo "📝 Add to .env.local:"
echo "NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=$ENGI_ADDRESS"
echo "NEXT_PUBLIC_ESCROW_ADDRESS=$ESCROW_ADDRESS"
echo "NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=$ATOMIQ_ADDRESS"
echo ""
