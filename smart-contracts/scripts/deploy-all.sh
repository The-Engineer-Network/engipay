#!/bin/bash

# EngiPay - Deploy All 3 Contracts Script
# This script automates the deployment of EngiToken, EscrowV2, and AtomiqAdapter

set -e  # Exit on error

echo "🚀 EngiPay Contract Deployment Script"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if required tools are installed
echo "📋 Checking prerequisites..."
if ! command -v scarb &> /dev/null; then
    echo -e "${RED}❌ Scarb not found. Please install: curl --proto '=https' --tlsv1.2 -sSf https://docs.swmansion.com/scarb/install.sh | sh${NC}"
    exit 1
fi

if ! command -v starkli &> /dev/null; then
    echo -e "${RED}❌ Starkli not found. Please install: curl https://get.starkli.sh | sh${NC}"
    exit 1
fi

echo -e "${GREEN}✅ All tools installed${NC}"
echo ""

# Get deployment parameters
echo "📝 Enter deployment parameters:"
read -p "Your wallet address: " WALLET_ADDRESS
read -p "Fee recipient address (or press Enter to use wallet address): " FEE_RECIPIENT
FEE_RECIPIENT=${FEE_RECIPIENT:-$WALLET_ADDRESS}

read -p "RPC URL (default: https://starknet-sepolia.public.blastapi.io): " RPC_URL
RPC_URL=${RPC_URL:-https://starknet-sepolia.public.blastapi.io}

read -p "Account file path (default: ~/.starkli-wallets/deployer/account.json): " ACCOUNT_FILE
ACCOUNT_FILE=${ACCOUNT_FILE:-~/.starkli-wallets/deployer/account.json}

read -p "Keystore file path (default: ~/.starkli-wallets/deployer/keystore.json): " KEYSTORE_FILE
KEYSTORE_FILE=${KEYSTORE_FILE:-~/.starkli-wallets/deployer/keystore.json}

echo ""
echo "🔧 Configuration:"
echo "  Wallet: $WALLET_ADDRESS"
echo "  Fee Recipient: $FEE_RECIPIENT"
echo "  RPC: $RPC_URL"
echo "  Account: $ACCOUNT_FILE"
echo ""

read -p "Continue with deployment? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ]; then
    echo "Deployment cancelled."
    exit 0
fi

# Export environment variables
export STARKNET_ACCOUNT=$ACCOUNT_FILE
export STARKNET_KEYSTORE=$KEYSTORE_FILE
export STARKNET_RPC=$RPC_URL

# Step 1: Compile contracts
echo ""
echo "🔨 Step 1/4: Compiling contracts..."
cd "$(dirname "$0")/.."
scarb build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Compilation successful${NC}"
else
    echo -e "${RED}❌ Compilation failed${NC}"
    exit 1
fi

# Create deployment log file
DEPLOY_LOG="deployment-$(date +%Y%m%d-%H%M%S).log"
echo "📝 Logging to: $DEPLOY_LOG"
echo ""

# Step 2: Deploy EngiToken
echo "🚀 Step 2/4: Deploying EngiToken..."
echo "Declaring EngiToken..."
ENGI_DECLARE_OUTPUT=$(starkli declare \
    target/dev/engipay_contracts_EngiToken.contract_class.json \
    --rpc $STARKNET_RPC \
    --account $STARKNET_ACCOUNT \
    --keystore $STARKNET_KEYSTORE 2>&1)

echo "$ENGI_DECLARE_OUTPUT" | tee -a $DEPLOY_LOG

ENGI_CLASS_HASH=$(echo "$ENGI_DECLARE_OUTPUT" | grep -oP 'Class hash declared: \K0x[0-9a-fA-F]+' || echo "$ENGI_DECLARE_OUTPUT" | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ENGI_CLASS_HASH" ]; then
    echo -e "${RED}❌ Failed to get EngiToken class hash${NC}"
    exit 1
fi

echo -e "${GREEN}✅ EngiToken class hash: $ENGI_CLASS_HASH${NC}"
echo ""

echo "Deploying EngiToken contract..."
ENGI_DEPLOY_OUTPUT=$(starkli deploy \
    $ENGI_CLASS_HASH \
    str:EngiPay \
    str:ENGI \
    u256:1000000000000000000000000 \
    $WALLET_ADDRESS \
    --rpc $STARKNET_RPC \
    --account $STARKNET_ACCOUNT \
    --keystore $STARKNET_KEYSTORE 2>&1)

echo "$ENGI_DEPLOY_OUTPUT" | tee -a $DEPLOY_LOG

ENGI_TOKEN_ADDRESS=$(echo "$ENGI_DEPLOY_OUTPUT" | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+' || echo "$ENGI_DEPLOY_OUTPUT" | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ENGI_TOKEN_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to deploy EngiToken${NC}"
    exit 1
fi

echo -e "${GREEN}✅ EngiToken deployed: $ENGI_TOKEN_ADDRESS${NC}"
echo ""

# Step 3: Deploy EscrowV2
echo "🚀 Step 3/4: Deploying EscrowV2..."
echo "Declaring EscrowV2..."
ESCROW_DECLARE_OUTPUT=$(starkli declare \
    target/dev/engipay_contracts_EscrowV2.contract_class.json \
    --rpc $STARKNET_RPC \
    --account $STARKNET_ACCOUNT \
    --keystore $STARKNET_KEYSTORE 2>&1)

echo "$ESCROW_DECLARE_OUTPUT" | tee -a $DEPLOY_LOG

ESCROW_CLASS_HASH=$(echo "$ESCROW_DECLARE_OUTPUT" | grep -oP 'Class hash declared: \K0x[0-9a-fA-F]+' || echo "$ESCROW_DECLARE_OUTPUT" | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ESCROW_CLASS_HASH" ]; then
    echo -e "${RED}❌ Failed to get EscrowV2 class hash${NC}"
    exit 1
fi

echo -e "${GREEN}✅ EscrowV2 class hash: $ESCROW_CLASS_HASH${NC}"
echo ""

echo "Deploying EscrowV2 contract..."
ESCROW_DEPLOY_OUTPUT=$(starkli deploy \
    $ESCROW_CLASS_HASH \
    $WALLET_ADDRESS \
    $FEE_RECIPIENT \
    u256:250 \
    --rpc $STARKNET_RPC \
    --account $STARKNET_ACCOUNT \
    --keystore $STARKNET_KEYSTORE 2>&1)

echo "$ESCROW_DEPLOY_OUTPUT" | tee -a $DEPLOY_LOG

ESCROW_ADDRESS=$(echo "$ESCROW_DEPLOY_OUTPUT" | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+' || echo "$ESCROW_DEPLOY_OUTPUT" | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ESCROW_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to deploy EscrowV2${NC}"
    exit 1
fi

echo -e "${GREEN}✅ EscrowV2 deployed: $ESCROW_ADDRESS${NC}"
echo ""

# Step 4: Deploy AtomiqAdapter
echo "🚀 Step 4/4: Deploying AtomiqAdapter..."
echo "Declaring AtomiqAdapter..."
ATOMIQ_DECLARE_OUTPUT=$(starkli declare \
    target/dev/engipay_contracts_AtomiqAdapter.contract_class.json \
    --rpc $STARKNET_RPC \
    --account $STARKNET_ACCOUNT \
    --keystore $STARKNET_KEYSTORE 2>&1)

echo "$ATOMIQ_DECLARE_OUTPUT" | tee -a $DEPLOY_LOG

ATOMIQ_CLASS_HASH=$(echo "$ATOMIQ_DECLARE_OUTPUT" | grep -oP 'Class hash declared: \K0x[0-9a-fA-F]+' || echo "$ATOMIQ_DECLARE_OUTPUT" | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ATOMIQ_CLASS_HASH" ]; then
    echo -e "${RED}❌ Failed to get AtomiqAdapter class hash${NC}"
    exit 1
fi

echo -e "${GREEN}✅ AtomiqAdapter class hash: $ATOMIQ_CLASS_HASH${NC}"
echo ""

echo "Deploying AtomiqAdapter contract..."
ATOMIQ_DEPLOY_OUTPUT=$(starkli deploy \
    $ATOMIQ_CLASS_HASH \
    $WALLET_ADDRESS \
    $FEE_RECIPIENT \
    u256:50 \
    u64:86400 \
    --rpc $STARKNET_RPC \
    --account $STARKNET_ACCOUNT \
    --keystore $STARKNET_KEYSTORE 2>&1)

echo "$ATOMIQ_DEPLOY_OUTPUT" | tee -a $DEPLOY_LOG

ATOMIQ_ADAPTER_ADDRESS=$(echo "$ATOMIQ_DEPLOY_OUTPUT" | grep -oP 'Contract deployed: \K0x[0-9a-fA-F]+' || echo "$ATOMIQ_DEPLOY_OUTPUT" | grep -oP '0x[0-9a-fA-F]{64}' | head -1)

if [ -z "$ATOMIQ_ADAPTER_ADDRESS" ]; then
    echo -e "${RED}❌ Failed to deploy AtomiqAdapter${NC}"
    exit 1
fi

echo -e "${GREEN}✅ AtomiqAdapter deployed: $ATOMIQ_ADAPTER_ADDRESS${NC}"
echo ""

# Summary
echo "======================================"
echo "🎉 DEPLOYMENT COMPLETE!"
echo "======================================"
echo ""
echo "📋 Contract Addresses:"
echo "  EngiToken:       $ENGI_TOKEN_ADDRESS"
echo "  EscrowV2:        $ESCROW_ADDRESS"
echo "  AtomiqAdapter:   $ATOMIQ_ADAPTER_ADDRESS"
echo ""
echo "🔗 Voyager Links (Sepolia):"
echo "  EngiToken:       https://sepolia.voyager.online/contract/$ENGI_TOKEN_ADDRESS"
echo "  EscrowV2:        https://sepolia.voyager.online/contract/$ESCROW_ADDRESS"
echo "  AtomiqAdapter:   https://sepolia.voyager.online/contract/$ATOMIQ_ADAPTER_ADDRESS"
echo ""
echo "📝 Environment Variables:"
echo ""
echo "# Frontend (.env.local)"
echo "NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=$ENGI_TOKEN_ADDRESS"
echo "NEXT_PUBLIC_ESCROW_ADDRESS=$ESCROW_ADDRESS"
echo "NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=$ATOMIQ_ADAPTER_ADDRESS"
echo ""
echo "# Backend (backend/.env)"
echo "ENGI_TOKEN_ADDRESS=$ENGI_TOKEN_ADDRESS"
echo "ESCROW_CONTRACT_ADDRESS=$ESCROW_ADDRESS"
echo "ATOMIQ_ADAPTER_ADDRESS=$ATOMIQ_ADAPTER_ADDRESS"
echo ""
echo "📄 Full deployment log saved to: $DEPLOY_LOG"
echo ""
echo "✅ Next steps:"
echo "  1. Update environment variables in .env.local and backend/.env"
echo "  2. Verify contracts on Voyager"
echo "  3. Test contract interactions"
echo "  4. Update demo script with contract addresses"
echo ""
