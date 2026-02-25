#!/bin/bash
# Setup Starknet Account for Deployment

set -e

echo "=========================================="
echo "Starknet Account Setup"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

NETWORK="sepolia"
RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"

echo -e "${BLUE}Step 1: Creating Starknet wallet...${NC}"
mkdir -p ~/.starkli-wallets/deployer

# Create keystore (encrypted private key)
echo -e "${YELLOW}Enter a password for your keystore (remember this!):${NC}"
starkli signer keystore new ~/.starkli-wallets/deployer/keystore.json

echo ""
echo -e "${GREEN}✓ Keystore created${NC}"
echo ""

echo -e "${BLUE}Step 2: Fetching account descriptor...${NC}"
echo -e "${YELLOW}Choose account type:${NC}"
echo "1. OpenZeppelin (recommended)"
echo "2. Argent"
read -p "Enter choice (1 or 2): " ACCOUNT_TYPE

if [ "$ACCOUNT_TYPE" = "1" ]; then
    CLASS_HASH="0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f"
    echo "Using OpenZeppelin account"
elif [ "$ACCOUNT_TYPE" = "2" ]; then
    CLASS_HASH="0x01a736d6ed154502257f02b1ccdf4d9d1089f80811cd6acad48e6b6a9d1f2003"
    echo "Using Argent account"
else
    echo -e "${RED}Invalid choice${NC}"
    exit 1
fi

# Fetch account descriptor
starkli account fetch \
    --rpc $RPC_URL \
    --output ~/.starkli-wallets/deployer/account.json \
    $CLASS_HASH

echo ""
echo -e "${GREEN}✓ Account descriptor fetched${NC}"
echo ""

echo -e "${BLUE}Step 3: Computing account address...${NC}"
ACCOUNT_ADDRESS=$(starkli account deploy \
    --rpc $RPC_URL \
    --keystore ~/.starkli-wallets/deployer/keystore.json \
    ~/.starkli-wallets/deployer/account.json \
    --max-fee 0.01 2>&1 | grep -oP '0x[0-9a-fA-F]+' | head -1 || echo "")

if [ -z "$ACCOUNT_ADDRESS" ]; then
    # Try to get address from account file
    echo -e "${YELLOW}Computing address...${NC}"
    # This will show the address that needs funding
    starkli account deploy \
        --rpc $RPC_URL \
        --keystore ~/.starkli-wallets/deployer/keystore.json \
        ~/.starkli-wallets/deployer/account.json \
        --max-fee 0.01 || true
fi

echo ""
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo -e "${YELLOW}IMPORTANT NEXT STEPS:${NC}"
echo ""
echo "1. Fund your account with Sepolia ETH:"
echo "   - Go to: https://starknet-faucet.vercel.app/"
echo "   - Or: https://faucet.quicknode.com/starknet/sepolia"
echo ""
echo "2. After funding, deploy your account:"
echo "   starkli account deploy \\"
echo "     --rpc $RPC_URL \\"
echo "     --keystore ~/.starkli-wallets/deployer/keystore.json \\"
echo "     ~/.starkli-wallets/deployer/account.json"
echo ""
echo "3. Set environment variables:"
echo "   export STARKNET_ACCOUNT=~/.starkli-wallets/deployer/account.json"
echo "   export STARKNET_KEYSTORE=~/.starkli-wallets/deployer/keystore.json"
echo ""
echo "4. Then deploy your contracts!"
echo ""
