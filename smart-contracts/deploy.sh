#!/bin/bash

# EngiPay Contract Deployment - Final Version
# Uses Nethermind RPC (most compatible with starkli)

set -e

echo "============================================"
echo "EngiPay Smart Contract Deployment"
echo "============================================"
echo ""

# Configuration - Using your wallet from .env.local
WALLET="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
RPC="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"
ACCOUNT_FILE=~/.starkli-wallets/account.json
SIGNER_FILE=~/.starkli-wallets/signer.json

echo "Wallet: $WALLET"
echo "RPC: $RPC"
echo ""

# Step 1: Fetch account
echo "Step 1: Setting up account..."
if [ ! -f $ACCOUNT_FILE ]; then
    starkli account fetch $WALLET --output $ACCOUNT_FILE --rpc $RPC
    echo "✓ Account fetched"
else
    echo "✓ Account exists"
fi
echo ""

# Step 2: Check signer
echo "Step 2: Checking signer..."
if [ ! -f $SIGNER_FILE ]; then
    echo "❌ Signer not found!"
    echo ""
    echo "Create it with: starkli signer keystore inspect $SIGNER_FILE"
    echo "Or if you have the private key:"
    echo "  starkli signer keystore from-key $SIGNER_FILE"
    exit 1
fi
echo "✓ Signer exists"
echo ""

# Step 3: Check balance
echo "Step 3: Checking STRK balance..."
starkli balance $WALLET --rpc $RPC || echo "Could not fetch balance"
echo ""

# Step 4: Declare contracts
echo "============================================"
echo "Step 4: Declaring Contracts"
echo "============================================"
echo ""

echo "Declaring EngiToken..."
ENGI_CLASS=$(starkli declare \
    target/dev/engipay_contracts_EngiToken.contract_class.json \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    2>&1 | grep -oP '0x[0-9a-fA-F]+' | tail -1)

if [ -z "$ENGI_CLASS" ]; then
    echo "❌ Failed to declare EngiToken"
    exit 1
fi
echo "✓ EngiToken class: $ENGI_CLASS"
echo ""

echo "Declaring EscrowV2..."
ESCROW_CLASS=$(starkli declare \
    target/dev/engipay_contracts_EscrowV2.contract_class.json \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    2>&1 | grep -oP '0x[0-9a-fA-F]+' | tail -1)

if [ -z "$ESCROW_CLASS" ]; then
    echo "❌ Failed to declare EscrowV2"
    exit 1
fi
echo "✓ EscrowV2 class: $ESCROW_CLASS"
echo ""

echo "Declaring AtomiqAdapter..."
ATOMIQ_CLASS=$(starkli declare \
    target/dev/engipay_contracts_AtomiqAdapter.contract_class.json \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    2>&1 | grep -oP '0x[0-9a-fA-F]+' | tail -1)

if [ -z "$ATOMIQ_CLASS" ]; then
    echo "❌ Failed to declare AtomiqAdapter"
    exit 1
fi
echo "✓ AtomiqAdapter class: $ATOMIQ_CLASS"
echo ""

# Step 5: Deploy contracts
echo "============================================"
echo "Step 5: Deploying Contracts"
echo "============================================"
echo ""

echo "Deploying EngiToken..."
ENGI_TOKEN=$(starkli deploy $ENGI_CLASS \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    str:"EngiPay Token" \
    str:"ENGI" \
    u256:1000000000000000000000000 \
    $WALLET \
    2>&1 | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+')

if [ -z "$ENGI_TOKEN" ]; then
    echo "❌ Failed to deploy EngiToken"
    exit 1
fi
echo "✓ EngiToken: $ENGI_TOKEN"
echo ""

echo "Deploying EscrowV2..."
ESCROW=$(starkli deploy $ESCROW_CLASS \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    $WALLET \
    $WALLET \
    u256:250 \
    2>&1 | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+')

if [ -z "$ESCROW" ]; then
    echo "❌ Failed to deploy EscrowV2"
    exit 1
fi
echo "✓ EscrowV2: $ESCROW"
echo ""

echo "Deploying AtomiqAdapter..."
ATOMIQ=$(starkli deploy $ATOMIQ_CLASS \
    --account $ACCOUNT_FILE \
    --keystore $SIGNER_FILE \
    --rpc $RPC \
    $WALLET \
    $WALLET \
    u256:100 \
    u64:86400 \
    2>&1 | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+')

if [ -z "$ATOMIQ" ]; then
    echo "❌ Failed to deploy AtomiqAdapter"
    exit 1
fi
echo "✓ AtomiqAdapter: $ATOMIQ"
echo ""

# Save results
echo "============================================"
echo "Deployment Complete!"
echo "============================================"
echo ""
echo "Contract Addresses:"
echo "-------------------"
echo "EngiToken:       $ENGI_TOKEN"
echo "EscrowV2:        $ESCROW"
echo "AtomiqAdapter:   $ATOMIQ"
echo ""

# Save to file
cat > deployment-addresses.json << EOF
{
  "network": "sepolia",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$WALLET",
  "contracts": {
    "EngiToken": "$ENGI_TOKEN",
    "EscrowV2": "$ESCROW",
    "AtomiqAdapter": "$ATOMIQ"
  },
  "explorer": {
    "EngiToken": "https://sepolia.starkscan.co/contract/$ENGI_TOKEN",
    "EscrowV2": "https://sepolia.starkscan.co/contract/$ESCROW",
    "AtomiqAdapter": "https://sepolia.starkscan.co/contract/$ATOMIQ"
  }
}
EOF

echo "✓ Saved to deployment-addresses.json"
echo ""
echo "Update your .env.local with these addresses!"
echo ""
