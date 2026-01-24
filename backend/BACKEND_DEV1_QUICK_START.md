# Backend Dev 1 - Quick Start Guide

## Setup (5 minutes)

```bash
# 1. Navigate to backend directory
cd backend

# 2. Copy environment template
cp .env.example .env

# 3. Edit .env and add your RPC URLs
# Get free API keys from:
# - Alchemy: https://www.alchemy.com/
# - Infura: https://www.infura.io/

# 4. Install dependencies
npm install

# 5. Test the service
node tests/test-blockchain-service.js

# 6. Start server
npm run dev
```

## What You Built Today

### 1. Blockchain Service (`services/blockchainService.js`)
- Ethereum RPC connection
- StarkNet RPC connection  
- Bitcoin API connection
- Real portfolio balance fetching
- Transaction broadcasting
- Transaction status tracking
- Gas estimation

### 2. Updated Routes
- `GET /api/portfolio/balances` - Real blockchain data
- `POST /api/transactions/broadcast` - Real transaction broadcasting
- `GET /api/transactions/:hash/status` - Real status tracking
- `POST /api/transactions/estimate-gas` - Gas estimation

## Test Your Work

### 1. Get Real Portfolio Balances
```bash
curl -X GET "http://localhost:3001/api/portfolio/balances" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 2. Estimate Gas
```bash
curl -X POST "http://localhost:3001/api/transactions/estimate-gas" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "network": "ethereum",
    "to": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "value": "0.01"
  }'
```

### 3. Get Transaction Status
```bash
curl -X GET "http://localhost:3001/api/transactions/0xYOUR_TX_HASH/status?network=ethereum" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Supported Networks

- **Ethereum** - ETH, USDC, USDT
- **StarkNet** - STRK
- **Bitcoin** - BTC

## Key Features

1. **Multi-Chain Balance Fetching**
   - Fetches real balances from blockchain
   - Supports multiple tokens per chain
   - Real-time USD value calculation

2. **Transaction Broadcasting**
   - Broadcasts signed transactions
   - Returns real transaction hash
   - Tracks transaction status

3. **Confirmation Tracking**
   - Real-time confirmation counting
   - Block number tracking
   - Gas fee calculation

4. **Gas Estimation**
   - Accurate gas limit estimation
   - EIP-1559 fee structure support
   - Cost calculation in ETH

## Environment Variables

Required in `.env`:
```env
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
STARKNET_RPC_URL=https://starknet-mainnet.public.blastapi.io
BITCOIN_RPC_URL=https://blockchain.info
```

## Files Created

```
backend/
├── services/
│   └── blockchainService.js          Core blockchain service
├── routes/
│   ├── portfolio.js                  Updated with real data
│   └── transactions.js               Updated with broadcasting
├── tests/
│   └── test-blockchain-service.js    Test suite
├── scripts/
│   ├── setup-backend-dev1.sh         Setup script (Linux/Mac)
│   └── setup-backend-dev1.bat        Setup script (Windows)
├── .env.example                      Environment template
├── BACKEND_DEV1_IMPLEMENTATION.md    Full documentation
└── BACKEND_DEV1_QUICK_START.md       This file
```

## Integration Points

### For Smart Contract Dev 1
```javascript
// Your blockchain service is ready to interact with deployed contracts
const blockchainService = require('./services/blockchainService');
```

### For Backend Dev 2 (DeFi)
```javascript
// Use for checking balances before DeFi operations
const balances = await blockchainService.getPortfolioBalances(address, 'ethereum');
```

### For Backend Dev 3 (Cross-Chain)
```javascript
// Use for tracking cross-chain transactions
const status = await blockchainService.getTransactionStatus(txHash, network);
```

### For Backend Dev 4 (Analytics)
```javascript
// Use for real-time portfolio analytics
const portfolio = await blockchainService.getPortfolioBalances(address, 'all');
```

## Troubleshooting

### Issue: "Failed to connect to RPC"
**Solution**: Check your RPC URLs in `.env` file

### Issue: "Rate limit exceeded"
**Solution**: Use authenticated RPC endpoints (Alchemy/Infura)

### Issue: "Invalid address"
**Solution**: Ensure wallet addresses are properly formatted

### Issue: "Transaction not found"
**Solution**: Wait a few seconds for transaction to propagate

## Next Steps (Day 2)

1. Add WebSocket support for real-time updates
2. Implement transaction monitoring service
3. Add support for more ERC20 tokens
4. Optimize RPC call batching
5. Coordinate with Smart Contract Dev 1

## Performance Tips

- Use Redis caching for price data
- Batch RPC calls when possible
- Implement retry logic for failed requests
- Monitor rate limits

## Security Notes

- Never commit `.env` file
- Rotate API keys regularly
- Validate all transaction data
- Implement rate limiting

## Success Metrics

- [x] All RPC connections working
- [x] Real balances fetching correctly
- [x] Transaction broadcasting functional
- [x] Status tracking accurate
- [x] Gas estimation working
- [x] All tests passing

## Day 1 Status: COMPLETE

**You've successfully implemented:**
- Blockchain RPC connections (3 networks)
- Real portfolio balance fetching
- Transaction broadcasting system
- Transaction confirmation tracking
- Gas estimation
- 4 new API endpoints
- Complete test suite
- Full documentation

**Ready for integration with the team!**

---

*Need help? Check BACKEND_DEV1_IMPLEMENTATION.md for detailed documentation*
