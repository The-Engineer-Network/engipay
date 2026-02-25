#!/bin/bash

echo "🚀 Deploying EngiToken and AtomiqAdapter to Testnet"
echo "===================================================="

ALCHEMY_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/Dij4b08u9UCGvFQ6sfgDP"
OWNER="0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431"

echo ""
echo "📝 Deploying EngiToken..."
echo "Name: EngiPay"
echo "Symbol: ENGI"
echo "Supply: 1,000,000 tokens"
echo ""

# Deploy EngiToken with string calldata
sncast deploy \
    --contract-name EngiToken \
    --url "$ALCHEMY_URL" \
    --constructor-calldata \
        str:EngiPay \
        str:ENGI \
        u256:1000000000000000000000000 \
        "$OWNER"

if [ $? -eq 0 ]; then
    echo "✅ EngiToken deployed successfully!"
else
    echo "❌ EngiToken deployment failed"
    exit 1
fi

echo ""
echo "📝 Deploying AtomiqAdapter..."
echo "Owner: $OWNER"
echo "Fee: 1%"
echo "Timeout: 24 hours"
echo ""

# Deploy AtomiqAdapter
sncast deploy \
    --contract-name AtomiqAdapter \
    --url "$ALCHEMY_URL" \
    --constructor-calldata \
        "$OWNER" \
        "$OWNER" \
        u256:100 \
        u64:86400

if [ $? -eq 0 ]; then
    echo "✅ AtomiqAdapter deployed successfully!"
else
    echo "❌ AtomiqAdapter deployment failed"
fi

echo ""
echo "🎉 Deployment complete!"
