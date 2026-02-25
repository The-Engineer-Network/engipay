#!/bin/bash

# EngiPay Contract Deployment - Debug Version
set -e

echo "============================================"
echo "EngiPay Smart Contract Deployment (DEBUG)"
echo "============================================"
echo ""

# Configuration
WALLET="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
# Try these RPC endpoints in order:
# RPC="https://rpc.starknet.lava.build"  # Not working - Method not found
RPC="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"  # Blast API - usually reliable
# RPC="https://free-rpc.nethermind.io/sepolia-juno/v0_7"  # Nethermind
# RPC="https://starknet-sepolia.g.alchemy.com/v2/demo"  # Alchemy demo
ACCOUNT_FILE=~/.starkli-wallets/account.json
SIGNER_FILE=~/.starkli-wallets/signer.json

echo "Wallet: $WALLET"
echo "RPC: $RPC"
echo ""

# Check if contract files exist
echo "Checking contract files..."
if [ ! -f "target/dev/engipay_contracts_EngiToken.contract_class.json" ]; then
    echo "❌ EngiToken contract file not found!"
    echo "Run: scarb build"
    exit 1
fi
echo "✓ Contract files exist"
echo ""

# Check balance
echo "Checking STRK balance..."
BALANCE=$(starkli balance $WALLET --rpc $RPC)
echo "Balance: $BALANCE STRK"
echo ""

# Declare EngiToken with full error output
echo "============================================"
echo "Declaring EngiToken..."
echo "============================================"
echo ""

starkli declare \
    target/dev/engipay_contracts_EngiToken.contract_class.json \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    --watch

echo ""
echo "If you see an error above, that's the issue to fix!"
