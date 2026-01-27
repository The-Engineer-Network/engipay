#!/bin/bash

# Backend Dev 1 Setup Script
# Run with: bash backend/scripts/setup-backend-dev1.sh

echo "🚀 Setting up Backend Dev 1 environment..."
echo ""

# Check if we're in the backend directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this script from the backend directory"
    echo "   cd backend && bash scripts/setup-backend-dev1.sh"
    exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo "⚠️  Please edit .env and add your RPC URLs:"
    echo "   - ETHEREUM_RPC_URL"
    echo "   - STARKNET_RPC_URL"
    echo "   - BITCOIN_RPC_URL"
    echo ""
else
    echo "✅ .env file already exists"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✅ Dependencies installed"
echo ""

# Create tests directory if it doesn't exist
if [ ! -d "tests" ]; then
    echo "📁 Creating tests directory..."
    mkdir -p tests
    echo "✅ Tests directory created"
fi

# Run test
echo "🧪 Running blockchain service tests..."
echo ""
node tests/test-blockchain-service.js

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 Backend Dev 1 setup complete!"
    echo ""
    echo "✅ Next steps:"
    echo "   1. Edit .env and add your RPC URLs"
    echo "   2. Run: npm run dev"
    echo "   3. Test endpoints with cURL or Postman"
    echo ""
    echo "📚 Documentation: backend/BACKEND_DEV1_IMPLEMENTATION.md"
else
    echo ""
    echo "⚠️  Tests failed. Please check your .env configuration"
    echo "   Make sure you have valid RPC URLs configured"
fi
