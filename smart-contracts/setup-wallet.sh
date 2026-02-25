#!/bin/bash

# EngiPay - Setup Wallet for Deployment
# This script sets up your starkli wallet using your private key

set -e

echo "============================================"
echo "EngiPay Wallet Setup"
echo "============================================"
echo ""

# Your wallet details from .env.local
WALLET_ADDRESS="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
PRIVATE_KEY="0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a"
RPC="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"

WALLET_DIR=~/.starkli-wallets
ACCOUNT_FILE=$WALLET_DIR/account.json
SIGNER_FILE=$WALLET_DIR/signer.json

echo "Creating wallet directory..."
mkdir -p $WALLET_DIR

# Step 1: Create signer from private key
echo ""
echo "Step 1: Creating signer from private key..."
if [ -f $SIGNER_FILE ]; then
    echo "⚠️  Signer file already exists at $SIGNER_FILE"
    read -p "Overwrite? (y/n): " OVERWRITE
    if [ "$OVERWRITE" != "y" ]; then
        echo "Skipping signer creation"
    else
        rm $SIGNER_FILE
        echo $PRIVATE_KEY | starkli signer keystore from-key $SIGNER_FILE
        echo "✓ Signer created"
    fi
else
    echo $PRIVATE_KEY | starkli signer keystore from-key $SIGNER_FILE
    echo "✓ Signer created"
fi

# Step 2: Fetch account
echo ""
echo "Step 2: Fetching account from network..."
if [ -f $ACCOUNT_FILE ]; then
    echo "⚠️  Account file already exists at $ACCOUNT_FILE"
    read -p "Overwrite? (y/n): " OVERWRITE
    if [ "$OVERWRITE" != "y" ]; then
        echo "Skipping account fetch"
    else
        rm $ACCOUNT_FILE
        starkli account fetch $WALLET_ADDRESS --output $ACCOUNT_FILE --rpc $RPC
        echo "✓ Account fetched"
    fi
else
    starkli account fetch $WALLET_ADDRESS --output $ACCOUNT_FILE --rpc $RPC
    echo "✓ Account fetched"
fi

# Step 3: Check balance
echo ""
echo "Step 3: Checking STRK balance..."
starkli balance $WALLET_ADDRESS --rpc $RPC

echo ""
echo "============================================"
echo "✓ Wallet Setup Complete!"
echo "============================================"
echo ""
echo "Wallet Address: $WALLET_ADDRESS"
echo "Account File:   $ACCOUNT_FILE"
echo "Signer File:    $SIGNER_FILE"
echo ""
echo "You can now run: ./deploy.sh"
echo ""

