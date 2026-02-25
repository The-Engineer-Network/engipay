#!/bin/bash

# EngiPay Quick Deployment Script
# This script helps you deploy contracts step by step

set -e

echo "============================================"
echo "EngiPay Quick Deployment"
echo "============================================"
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if starkli is installed
if ! command -v starkli &> /dev/null; then
    echo -e "${RED}Error: starkli is not installed${NC}"
    echo ""
    echo "Install it with:"
    echo "  curl https://get.starkli.sh | sh"
    echo "  starkliup"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ starkli found${NC}"

# Check if account exists
if [ ! -f ~/.starkli-wallets/deployer/account.json ]; then
    echo -e "${YELLOW}⚠ No account found at ~/.starkli-wallets/deployer/account.json${NC}"
    echo ""
    echo "You need to set up a Starknet account first."
    echo "See DEPLOY_STEP_BY_STEP.md for instructions."
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Account found${NC}"

# Check if keystore exists
if [ ! -f ~/.starkli-wallets/deployer/keystore.json ]; then
    echo -e "${YELLOW}⚠ No keystore found at ~/.starkli-wallets/deployer/keystore.json${NC}"
    echo ""
    echo "You need to set up a keystore first."
    echo "See DEPLOY_STEP_BY_STEP.md for instructions."
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Keystore found${NC}"
echo ""

# Configuration
NETWORK="sepolia"
RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"
ACCOUNT_FILE=~/.starkli-wallets/deployer/account.json
KEYSTORE_FILE=~/.starkli-wallets/deployer/keystore.json

echo -e "${BLUE}Network:${NC} $NETWORK"
echo -e "${BLUE}RPC:${NC} $RPC_URL"
echo ""

# Get deployer address from account file
DEPLOYER_ADDRESS=$(cat $ACCOUNT_FILE | grep -o '"address": *"[^"]*"' | cut -d'"' -f4)
echo -e "${BLUE}Deployer Address:${NC} $DEPLOYER_ADDRESS"
echo ""

# Check balance
echo -e "${YELLOW}Checking account balance...${NC}"
BALANCE=$(starkli balance $DEPLOYER_ADDRESS --rpc $RPC_URL 2>/dev/null || echo "0")
echo -e "${BLUE}Balance:${NC} $BALANCE ETH"

if [ "$BALANCE" = "0" ]; then
    echo -e "${RED}⚠ Warning: Your account has no balance!${NC}"
    echo "Get testnet ETH from: https://starknet-faucet.vercel.app/"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${YELLOW}Starting deployment...${NC}"
echo ""

# Function to declare and deploy
declare_and_deploy() {
    local CONTRACT_NAME=$1
    local CONTRACT_FILE=$2
    shift 2
    local CONSTRUCTOR_ARGS=("$@")
    
    echo -e "${YELLOW}Deploying $CONTRACT_NAME...${NC}"
    
    # Declare
    echo "  Declaring contract..."
    CLASS_HASH=$(starkli declare \
        $CONTRACT_FILE \
        --network $NETWORK \
        --rpc $RPC_URL \
        --keystore $KEYSTORE_FILE \
        --account $ACCOUNT_FILE \
        2>&1 | grep -o '0x[0-9a-fA-F]\{64\}' | head -1)
    
    if [ -z "$CLASS_HASH" ]; then
        echo -e "${RED}  ✗ Failed to declare $CONTRACT_NAME${NC}"
        return 1
    fi
    
    echo -e "${GREEN}  ✓ Declared with class hash: $CLASS_HASH${NC}"
    
    # Deploy
    echo "  Deploying contract..."
    CONTRACT_ADDRESS=$(starkli deploy \
        $CLASS_HASH \
        --network $NETWORK \
        --rpc $RPC_URL \
        --keystore $KEYSTORE_FILE \
        --account $ACCOUNT_FILE \
        "${CONSTRUCTOR_ARGS[@]}" \
        2>&1 | grep -o '0x[0-9a-fA-F]\{64\}' | head -1)
    
    if [ -z "$CONTRACT_ADDRESS" ]; then
        echo -e "${RED}  ✗ Failed to deploy $CONTRACT_NAME${NC}"
        return 1
    fi
    
    echo -e "${GREEN}  ✓ Deployed at: $CONTRACT_ADDRESS${NC}"
    echo ""
    
    # Save to file
    echo "$CONTRACT_NAME=$CONTRACT_ADDRESS" >> deployment-addresses.txt
    
    eval "${CONTRACT_NAME}_ADDRESS=$CONTRACT_ADDRESS"
}

# Create/clear deployment file
> deployment-addresses.txt
echo "NETWORK=$NETWORK" >> deployment-addresses.txt
echo "DEPLOYER=$DEPLOYER_ADDRESS" >> deployment-addresses.txt
echo "" >> deployment-addresses.txt

# Deploy EngiToken
declare_and_deploy \
    "ENGI_TOKEN" \
    "target/dev/engipay_contracts_EngiToken.contract_class.json" \
    str:"EngiPay Token" \
    str:"ENGI" \
    u256:1000000000000000000000000 \
    $DEPLOYER_ADDRESS

# Deploy EscrowV2
declare_and_deploy \
    "ESCROW_V2" \
    "target/dev/engipay_contracts_EscrowV2.contract_class.json" \
    $DEPLOYER_ADDRESS \
    $DEPLOYER_ADDRESS \
    u256:250

# Deploy RewardDistributorV2 (if exists)
if [ -f "target/dev/engipay_contracts_RewardDistributorV2.contract_class.json" ]; then
    declare_and_deploy \
        "REWARD_DISTRIBUTOR" \
        "target/dev/engipay_contracts_RewardDistributorV2.contract_class.json" \
        $DEPLOYER_ADDRESS
fi

# Deploy AtomiqAdapter (if exists)
if [ -f "target/dev/engipay_contracts_AtomiqAdapter.contract_class.json" ]; then
    declare_and_deploy \
        "ATOMIQ_ADAPTER" \
        "target/dev/engipay_contracts_AtomiqAdapter.contract_class.json" \
        $DEPLOYER_ADDRESS \
        $DEPLOYER_ADDRESS \
        u256:100 \
        u64:86400
fi

echo ""
echo "============================================"
echo -e "${GREEN}Deployment Complete!${NC}"
echo "============================================"
echo ""
echo "Contract addresses saved to: deployment-addresses.txt"
echo ""
cat deployment-addresses.txt
echo ""
echo "View on Starkscan:"
echo "https://sepolia.starkscan.co/contract/$ENGI_TOKEN_ADDRESS"
echo ""
