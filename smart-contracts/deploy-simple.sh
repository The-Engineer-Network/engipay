#!/bin/bash
# Simple deployment script for EngiPay contracts

set -e

echo "=========================================="
echo "EngiPay Contract Deployment"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
NETWORK="sepolia"
RPC_URL="https://starknet-sepolia.public.blastapi.io/rpc/v0_7"
ACCOUNT_FILE="${STARKNET_ACCOUNT:-$HOME/.starkli-wallets/deployer/account.json}"
KEYSTORE_FILE="${STARKNET_KEYSTORE:-$HOME/.starkli-wallets/deployer/keystore.json}"

# Check if account exists
if [ ! -f "$ACCOUNT_FILE" ]; then
    echo -e "${RED}Error: Account file not found at $ACCOUNT_FILE${NC}"
    echo "Run ./setup-account.sh first"
    exit 1
fi

if [ ! -f "$KEYSTORE_FILE" ]; then
    echo -e "${RED}Error: Keystore file not found at $KEYSTORE_FILE${NC}"
    echo "Run ./setup-account.sh first"
    exit 1
fi

# Get account address
ACCOUNT_ADDRESS=$(cat $ACCOUNT_FILE | grep -oP '"deployment":\s*\{\s*"address":\s*"\K0x[0-9a-fA-F]+' || \
                  cat $ACCOUNT_FILE | grep -oP '"address":\s*"\K0x[0-9a-fA-F]+' | head -1)

if [ -z "$ACCOUNT_ADDRESS" ]; then
    echo -e "${RED}Error: Could not extract account address${NC}"
    exit 1
fi

echo -e "${BLUE}Network:${NC} $NETWORK"
echo -e "${BLUE}RPC:${NC} $RPC_URL"
echo -e "${BLUE}Account:${NC} $ACCOUNT_ADDRESS"
echo ""

# Build contracts
echo -e "${YELLOW}Building contracts...${NC}"
scarb build
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Function to declare and deploy
declare_and_deploy() {
    local CONTRACT_NAME=$1
    local CONSTRUCTOR_ARGS=$2
    
    echo -e "${YELLOW}Deploying $CONTRACT_NAME...${NC}"
    
    local CONTRACT_FILE="target/dev/engipay_contracts_${CONTRACT_NAME}.contract_class.json"
    
    if [ ! -f "$CONTRACT_FILE" ]; then
        echo -e "${RED}Error: Contract file not found: $CONTRACT_FILE${NC}"
        return 1
    fi
    
    # Declare the contract
    echo "Declaring contract..."
    CLASS_HASH=$(starkli declare \
        --rpc $RPC_URL \
        --account $ACCOUNT_FILE \
        --keystore $KEYSTORE_FILE \
        $CONTRACT_FILE \
        2>&1 | grep -oP 'Class hash declared:\s*\K0x[0-9a-fA-F]+' || \
        starkli declare \
        --rpc $RPC_URL \
        --account $ACCOUNT_FILE \
        --keystore $KEYSTORE_FILE \
        $CONTRACT_FILE \
        2>&1 | grep -oP '0x[0-9a-fA-F]+' | head -1)
    
    if [ -z "$CLASS_HASH" ]; then
        echo -e "${YELLOW}Contract may already be declared, trying to deploy...${NC}"
        # Try to get class hash from file
        CLASS_HASH=$(cat $CONTRACT_FILE | grep -oP '"class_hash":\s*"\K0x[0-9a-fA-F]+' | head -1)
    fi
    
    echo "Class hash: $CLASS_HASH"
    
    # Deploy the contract
    echo "Deploying contract..."
    CONTRACT_ADDRESS=$(starkli deploy \
        --rpc $RPC_URL \
        --account $ACCOUNT_FILE \
        --keystore $KEYSTORE_FILE \
        $CLASS_HASH \
        $CONSTRUCTOR_ARGS \
        2>&1 | grep -oP 'Contract deployed:\s*\K0x[0-9a-fA-F]+' || \
        starkli deploy \
        --rpc $RPC_URL \
        --account $ACCOUNT_FILE \
        --keystore $KEYSTORE_FILE \
        $CLASS_HASH \
        $CONSTRUCTOR_ARGS \
        2>&1 | grep -oP '0x[0-9a-fA-F]+' | tail -1)
    
    echo -e "${GREEN}✓ $CONTRACT_NAME deployed at: $CONTRACT_ADDRESS${NC}"
    echo ""
    
    echo "$CONTRACT_ADDRESS"
}

# Deploy EngiToken
echo -e "${BLUE}=== Deploying EngiToken ===${NC}"
ENGI_TOKEN=$(declare_and_deploy "EngiToken" \
    "str:EngiPay str:ENGI u256:1000000000000000000000000 $ACCOUNT_ADDRESS")

# Deploy EscrowV2
echo -e "${BLUE}=== Deploying EscrowV2 ===${NC}"
ESCROW=$(declare_and_deploy "EscrowV2" \
    "$ACCOUNT_ADDRESS $ACCOUNT_ADDRESS u256:250")

# Save addresses
cat > deployment-addresses.json << EOF
{
  "network": "$NETWORK",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployer": "$ACCOUNT_ADDRESS",
  "contracts": {
    "EngiToken": "$ENGI_TOKEN",
    "EscrowV2": "$ESCROW"
  }
}
EOF

echo ""
echo "=========================================="
echo -e "${GREEN}Deployment Complete!${NC}"
echo "=========================================="
echo ""
echo "Contract Addresses:"
echo "-------------------"
echo -e "${BLUE}EngiToken:${NC} $ENGI_TOKEN"
echo -e "${BLUE}EscrowV2:${NC}  $ESCROW"
echo ""
echo "Addresses saved to: deployment-addresses.json"
echo ""
echo "View on Starkscan:"
echo "https://sepolia.starkscan.co/contract/$ENGI_TOKEN"
echo "https://sepolia.starkscan.co/contract/$ESCROW"
echo ""
