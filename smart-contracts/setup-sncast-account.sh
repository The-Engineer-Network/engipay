#!/bin/bash

# Setup sncast account for deployment

echo "============================================"
echo "Setting up sncast account"
echo "============================================"
echo ""

ACCOUNT_NAME="engipay-deployer"
WALLET="0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d"
RPC="https://rpc.starknet.lava.build"

echo "This will create a sncast account configuration."
echo "You'll need to provide your private key."
echo ""
echo "Account name: $ACCOUNT_NAME"
echo "Wallet address: $WALLET"
echo "RPC: $RPC"
echo ""

# Create account
sncast \
    --url $RPC \
    account add \
    --name $ACCOUNT_NAME \
    --address $WALLET \
    --type oz \
    --private-key-file <(echo "Enter your private key when prompted")

echo ""
echo "✓ Account setup complete!"
echo ""
echo "Now you can run: ./deploy-sncast.sh"
