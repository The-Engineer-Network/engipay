#!/bin/bash

# EngiPay Mainnet Deployment Script
# This script deploys all contracts to Starknet Mainnet

set -e  # Exit on error

echo "=========================================="
echo "EngiPay Mainnet Deployment"
echo "=========================================="
echo ""

# Configuration
ACCOUNT_FILE="$HOME/.starkli-wallets/deployer/account.json"
KEYSTORE_FILE="$HOME/.starkli-wallets/deployer/keystore.json"
RPC_URL="https://rpc.starknet.lava.build"

# Contract files
ENGI_TOKEN="target/dev/engipay_contracts_EngiToken.contract_class.json"
ESCROW_V2="target/dev/engipay_contracts_EscrowV2.contract_class.json"
ATOMIQ_ADAPTER="target/dev/engipay_contracts_AtomiqAdapter.contract_class.json"

# Check if contracts are built
if [ ! -f "$ENGI_TOKEN" ]; then
    echo "❌ Contracts not built. Run 'scarb build' first."
    exit 1
fi

echo "✅ All contract files found"
echo ""

# Step 1: Deploy account if undeployed
echo "Step 1: Checking account deployment status..."
ACCOUNT_STATUS=$(cat $ACCOUNT_FILE | grep -o '"status": "[^"]*"' | cut -d'"' -f4)

if [ "$ACCOUNT_STATUS" = "undeployed" ]; then
    echo "⚠️  Account is undeployed. Deploying account first..."
    echo "You will be prompted for your keystore password."
    echo ""
    
    starkli account deploy \
        --rpc $RPC_URL \
        --keystore $KEYSTORE_FILE \
        $ACCOUNT_FILE
    
    echo ""
    echo "✅ Account deployed successfully!"
    echo ""
else
    echo "✅ Account already deployed"
    echo ""
fi

# Get account address
ACCOUNT_ADDRESS=$(starkli account fetch $ACCOUNT_FILE --rpc $RPC_URL 2>/dev/null | grep -o '0x[a-fA-F0-9]*' | head -1)
echo "📍 Deploying from account: $ACCOUNT_ADDRESS"
echo ""

# Step 2: Declare contracts (if needed)
echo "Step 2: Declaring contracts..."
echo ""

echo "Declaring EngiToken..."
ENGI_TOKEN_HASH=$(starkli declare \
    --rpc $RPC_URL \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE_FILE \
    $ENGI_TOKEN 2>&1 | grep -o '0x[a-fA-F0-9]*' | tail -1)
echo "✅ EngiToken class hash: $ENGI_TOKEN_HASH"
echo ""

echo "Declaring EscrowV2..."
ESCROW_HASH=$(starkli declare \
    --rpc $RPC_URL \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE_FILE \
    $ESCROW_V2 2>&1 | grep -o '0x[a-fA-F0-9]*' | tail -1)
echo "✅ EscrowV2 class hash: $ESCROW_HASH"
echo ""

echo "Declaring AtomiqAdapter..."
ATOMIQ_HASH=$(starkli declare \
    --rpc $RPC_URL \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE_FILE \
    $ATOMIQ_ADAPTER 2>&1 | grep -o '0x[a-fA-F0-9]*' | tail -1)
echo "✅ AtomiqAdapter class hash: $ATOMIQ_HASH"
echo ""

# Step 3: Deploy EngiToken
echo "Step 3: Deploying EngiToken..."
echo "Constructor params: name='EngiPay', symbol='ENGI', supply=1000000 tokens, owner=$ACCOUNT_ADDRESS"
echo ""

ENGI_TOKEN_ADDRESS=$(starkli deploy \
    --rpc $RPC_URL \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE_FILE \
    $ENGI_TOKEN_HASH \
    str:EngiPay \
    str:ENGI \
    u256:1000000000000000000000000 \
    $ACCOUNT_ADDRESS 2>&1 | grep -o '0x[a-fA-F0-9]*' | tail -1)

echo "✅ EngiToken deployed at: $ENGI_TOKEN_ADDRESS"
echo ""

# Step 4: Deploy EscrowV2
echo "Step 4: Deploying EscrowV2..."
echo "Constructor params: owner=$ACCOUNT_ADDRESS, fee_recipient=$ACCOUNT_ADDRESS, fee=250 (2.5%)"
echo ""

ESCROW_ADDRESS=$(starkli deploy \
    --rpc $RPC_URL \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE_FILE \
    $ESCROW_HASH \
    $ACCOUNT_ADDRESS \
    $ACCOUNT_ADDRESS \
    u256:250 2>&1 | grep -o '0x[a-fA-F0-9]*' | tail -1)

echo "✅ EscrowV2 deployed at: $ESCROW_ADDRESS"
echo ""

# Step 5: Deploy AtomiqAdapter
echo "Step 5: Deploying AtomiqAdapter..."
echo "Constructor params: owner=$ACCOUNT_ADDRESS, fee_recipient=$ACCOUNT_ADDRESS, fee=100 (1%), timeout=86400s"
echo ""

ATOMIQ_ADDRESS=$(starkli deploy \
    --rpc $RPC_URL \
    --account $ACCOUNT_FILE \
    --keystore $KEYSTORE_FILE \
    $ATOMIQ_HASH \
    $ACCOUNT_ADDRESS \
    $ACCOUNT_ADDRESS \
    u256:100 \
    u64:86400 2>&1 | grep -o '0x[a-fA-F0-9]*' | tail -1)

echo "✅ AtomiqAdapter deployed at: $ATOMIQ_ADDRESS"
echo ""

# Step 6: Save addresses
echo "=========================================="
echo "🎉 Deployment Complete!"
echo "=========================================="
echo ""
echo "Contract Addresses (MAINNET):"
echo "-------------------------------------------"
echo "EngiToken:      $ENGI_TOKEN_ADDRESS"
echo "EscrowV2:       $ESCROW_ADDRESS"
echo "AtomiqAdapter:  $ATOMIQ_ADDRESS"
echo "-------------------------------------------"
echo ""

# Save to file
cat > deployment-addresses-mainnet.txt << EOF
# EngiPay Mainnet Contract Addresses
# Deployed: $(date)
# Network: Starknet Mainnet

ENGI_TOKEN_ADDRESS=$ENGI_TOKEN_ADDRESS
ESCROW_CONTRACT_ADDRESS=$ESCROW_ADDRESS
ATOMIQ_ADAPTER_ADDRESS=$ATOMIQ_ADDRESS

# Verify on StarkScan:
# EngiToken: https://starkscan.co/contract/$ENGI_TOKEN_ADDRESS
# EscrowV2: https://starkscan.co/contract/$ESCROW_ADDRESS
# AtomiqAdapter: https://starkscan.co/contract/$ATOMIQ_ADDRESS
EOF

echo "✅ Addresses saved to: deployment-addresses-mainnet.txt"
echo ""
echo "Next steps:"
echo "1. Verify contracts on StarkScan"
echo "2. Update .env.local with these addresses"
echo "3. Test contract interactions"
echo ""
