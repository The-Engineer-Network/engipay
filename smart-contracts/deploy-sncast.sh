#!/bin/bash

# EngiPay Contract Deployment using sncast
set -e

echo "============================================"
echo "EngiPay Smart Contract Deployment (sncast)"
echo "============================================"
echo ""

# Configuration
ACCOUNT_NAME="engipay-deployer"
WALLET="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
RPC="https://rpc.starknet.lava.build"
NETWORK="sepolia"

echo "Wallet: $WALLET"
echo "RPC: $RPC"
echo "Network: $NETWORK"
echo ""

# Step 1: Check if contracts are built
echo "Step 1: Checking contract files..."
if [ ! -f "target/dev/engipay_contracts_EngiToken.contract_class.json" ]; then
    echo "Building contracts..."
    scarb build
fi
echo "✓ Contract files ready"
echo ""

# Step 2: Check balance
echo "Step 2: Checking STRK balance..."
sncast --url $RPC account balance --address $WALLET || echo "Could not fetch balance"
echo ""

# Step 3: Declare contracts
echo "============================================"
echo "Step 3: Declaring Contracts"
echo "============================================"
echo ""

echo "Declaring EngiToken..."
ENGI_CLASS=$(sncast \
    --profile sepolia \
    declare \
    --contract-name EngiToken \
    --fee-token strk \
    2>&1 | grep -oP 'class_hash: \K0x[0-9a-fA-F]+' || echo "")

if [ -z "$ENGI_CLASS" ]; then
    echo "⚠️  EngiToken might already be declared or failed"
    echo "Trying to get existing class hash..."
    # You can manually set it if already declared
    # ENGI_CLASS="0x..."
else
    echo "✓ EngiToken class: $ENGI_CLASS"
fi
echo ""

echo "Declaring EscrowV2..."
ESCROW_CLASS=$(sncast \
    --profile sepolia \
    declare \
    --contract-name EscrowV2 \
    --fee-token strk \
    2>&1 | grep -oP 'class_hash: \K0x[0-9a-fA-F]+' || echo "")

if [ -z "$ESCROW_CLASS" ]; then
    echo "⚠️  EscrowV2 might already be declared or failed"
else
    echo "✓ EscrowV2 class: $ESCROW_CLASS"
fi
echo ""

echo "Declaring AtomiqAdapter..."
ATOMIQ_CLASS=$(sncast \
    --profile sepolia \
    declare \
    --contract-name AtomiqAdapter \
    --fee-token strk \
    2>&1 | grep -oP 'class_hash: \K0x[0-9a-fA-F]+' || echo "")

if [ -z "$ATOMIQ_CLASS" ]; then
    echo "⚠️  AtomiqAdapter might already be declared or failed"
else
    echo "✓ AtomiqAdapter class: $ATOMIQ_CLASS"
fi
echo ""

# Step 4: Deploy contracts (if class hashes are available)
if [ ! -z "$ENGI_CLASS" ]; then
    echo "============================================"
    echo "Step 4: Deploying Contracts"
    echo "============================================"
    echo ""

    echo "Deploying EngiToken..."
    ENGI_TOKEN=$(sncast \
        --profile sepolia \
        deploy \
        --class-hash $ENGI_CLASS \
        --fee-token strk \
        --constructor-calldata \
            str:"EngiPay Token" \
            str:"ENGI" \
            u256:1000000000000000000000000 \
            $WALLET \
        2>&1 | grep -oP 'contract_address: \K0x[0-9a-fA-F]+' || echo "")

    if [ ! -z "$ENGI_TOKEN" ]; then
        echo "✓ EngiToken: $ENGI_TOKEN"
    fi
    echo ""

    if [ ! -z "$ESCROW_CLASS" ]; then
        echo "Deploying EscrowV2..."
        ESCROW=$(sncast \
            --profile sepolia \
            deploy \
            --class-hash $ESCROW_CLASS \
            --fee-token strk \
            --constructor-calldata \
                $WALLET \
                $WALLET \
                u256:250 \
            2>&1 | grep -oP 'contract_address: \K0x[0-9a-fA-F]+' || echo "")

        if [ ! -z "$ESCROW" ]; then
            echo "✓ EscrowV2: $ESCROW"
        fi
        echo ""
    fi

    if [ ! -z "$ATOMIQ_CLASS" ]; then
        echo "Deploying AtomiqAdapter..."
        ATOMIQ=$(sncast \
            --profile sepolia \
            deploy \
            --class-hash $ATOMIQ_CLASS \
            --fee-token strk \
            --constructor-calldata \
                $WALLET \
                $WALLET \
                u256:100 \
                u64:86400 \
            2>&1 | grep -oP 'contract_address: \K0x[0-9a-fA-F]+' || echo "")

        if [ ! -z "$ATOMIQ" ]; then
            echo "✓ AtomiqAdapter: $ATOMIQ"
        fi
        echo ""
    fi

    # Save results if we have addresses
    if [ ! -z "$ENGI_TOKEN" ] || [ ! -z "$ESCROW" ] || [ ! -z "$ATOMIQ" ]; then
        echo "============================================"
        echo "Deployment Complete!"
        echo "============================================"
        echo ""
        echo "Contract Addresses:"
        echo "-------------------"
        [ ! -z "$ENGI_TOKEN" ] && echo "EngiToken:       $ENGI_TOKEN"
        [ ! -z "$ESCROW" ] && echo "EscrowV2:        $ESCROW"
        [ ! -z "$ATOMIQ" ] && echo "AtomiqAdapter:   $ATOMIQ"
        echo ""

        # Save to file
        cat > deployment-addresses.json << EOF
{
  "network": "sepolia",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$WALLET",
  "contracts": {
    "EngiToken": "${ENGI_TOKEN:-0x0}",
    "EscrowV2": "${ESCROW:-0x0}",
    "AtomiqAdapter": "${ATOMIQ:-0x0}"
  },
  "classHashes": {
    "EngiToken": "${ENGI_CLASS:-0x0}",
    "EscrowV2": "${ESCROW_CLASS:-0x0}",
    "AtomiqAdapter": "${ATOMIQ_CLASS:-0x0}"
  }
}
EOF

        echo "✓ Saved to deployment-addresses.json"
        echo ""
    fi
fi

echo "Done!"
