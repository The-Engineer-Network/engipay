#!/bin/bash

# EngiPay Contract Deployment using sncast v0.56.0
set -e

echo "============================================"
echo "EngiPay Smart Contract Deployment (sncast)"
echo "============================================"
echo ""

WALLET="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"

echo "Wallet: $WALLET"
echo "Using profile: sepolia"
echo ""

# Step 1: Check if contracts are built
echo "Step 1: Checking contract files..."
if [ ! -f "target/dev/engipay_contracts_EngiToken.contract_class.json" ]; then
    echo "Building contracts..."
    scarb build
fi
echo "✓ Contract files ready"
echo ""

# Step 2: Declare contracts
echo "============================================"
echo "Step 2: Declaring Contracts"
echo "============================================"
echo ""

echo "Declaring EngiToken..."
sncast --profile sepolia declare --contract-name EngiToken
echo ""

echo "Declaring EscrowV2..."
sncast --profile sepolia declare --contract-name EscrowV2
echo ""

echo "Declaring AtomiqAdapter..."
sncast --profile sepolia declare --contract-name AtomiqAdapter
echo ""

echo "============================================"
echo "Contracts declared successfully!"
echo "============================================"
echo ""
echo "To deploy the contracts, you need to:"
echo "1. Note the class hashes from the output above"
echo "2. Run deploy commands with those class hashes"
echo ""
echo "Example deploy command:"
echo "sncast --profile sepolia deploy \\"
echo "  --class-hash <CLASS_HASH> \\"
echo "  --constructor-calldata <ARGS>"
echo ""
