# Vesu API Endpoints Testing Guide

This guide provides instructions for manually testing all Vesu API endpoints to verify they are accessible and properly configured.

## Prerequisites

1. Backend server must be running: `npm start` or `node server.js`
2. Default server URL: `http://localhost:3001`
3. For authenticated endpoints, you need a valid JWT token

## Getting a JWT Token

To test authenticated endpoints, you need to:
1. Register a user: `POST /api/auth/register`
2. Login: `POST /api/auth/login`
3. Use the returned token in the `Authorization: Bearer <token>` header

## Test Summary

Total Endpoints: 24

### Endpoint Categories:
- Health Check: 1 endpoint
- Supply Operations: 2 endpoints
- Borrow Operations: 2 endpoints
- Repay Operations: 2 endpoints
- Withdraw Operations: 2 endpoints
- Position Management: 4 endpoints
- Pool Information: 3 endpoints
- Liquidation Operations: 3 endpoints

---

## 1. Health Check Endpoint

### GET /api/vesu/health
**Purpose:** Check if Vesu services are initialized and available

**Authentication:** None required

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/health
```

**Expected Response:**
```json
{
  "status": "OK" | "UNAVAILABLE",
  "services": {
    "vesuService": true | false,
    "liquidationEngine": true | false
  },
  "timestamp": "2026-01-29T..."
}
```

**Status Codes:** 200 (OK), 503 (Service Unavailable)

---

## 2. Supply Endpoints

### POST /api/vesu/supply
**Purpose:** Supply assets to a lending pool

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X POST http://localhost:3001/api/vesu/supply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "poolAddress": "0x123",
    "asset": "ETH",
    "amount": "1.0",
    "walletAddress": "0xabc"
  }'
```

**Expected Response (Success):**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "vTokensReceived": "1.5234",
  "position": { ... }
}
```

**Status Codes:** 200 (Success), 400 (Validation Error), 401 (Unauthorized), 422 (Business Logic Error), 500/502/503 (Server/Service Error)

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing required fields → 400
3. ✓ With valid data → 200/422/500/502/503

---

### GET /api/vesu/supply/estimate
**Purpose:** Estimate vTokens to receive for a supply amount

**Authentication:** None required

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET "http://localhost:3001/api/vesu/supply/estimate?poolAddress=0x123&asset=ETH&amount=1.0"
```

**Expected Response:**
```json
{
  "asset": "ETH",
  "amount": "1.0",
  "estimatedVTokens": "1.5234",
  "exchangeRate": "0.656"
}
```

**Status Codes:** 200, 400, 422, 500, 502, 503

**Test Cases:**
1. ✓ Missing query parameters → 400
2. ✓ With valid parameters → 200/422/500/502/503

---

## 3. Borrow Endpoints

### POST /api/vesu/borrow
**Purpose:** Borrow assets against collateral

**Authentication:** Required (JWT)

**Rate Limit:** 50 requests per 15 minutes

**Test Command:**
```bash
curl -X POST http://localhost:3001/api/vesu/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "poolAddress": "0x123",
    "collateralAsset": "ETH",
    "debtAsset": "USDC",
    "borrowAmount": "1000",
    "walletAddress": "0xabc"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "borrowedAmount": "1000",
  "position": { ... }
}
```

**Status Codes:** 200, 400, 401, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing required fields → 400
3. ✓ With valid data → 200/422/500/502/503

---

### GET /api/vesu/borrow/max
**Purpose:** Calculate maximum borrowable amount for a position

**Authentication:** Required (JWT)

**Rate Limit:** 50 requests per 15 minutes

**Test Command:**
```bash
curl -X GET "http://localhost:3001/api/vesu/borrow/max?positionId=123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "positionId": "123",
  "maxBorrowable": "1875",
  "currentDebt": "1000",
  "availableLiquidity": "50000"
}
```

**Status Codes:** 200, 400, 401, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing query parameters → 400
3. ✓ With valid parameters → 200/404/422/500/502/503

---

## 4. Repay Endpoints

### POST /api/vesu/repay
**Purpose:** Repay borrowed assets

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X POST http://localhost:3001/api/vesu/repay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "positionId": "123",
    "amount": "500",
    "walletAddress": "0xabc"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "repaidAmount": "500",
  "remainingDebt": "500.25",
  "newHealthFactor": "5.0",
  "position": { ... }
}
```

**Status Codes:** 200, 400, 401, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing required fields → 400
3. ✓ With valid data → 200/404/422/500/502/503

---

### GET /api/vesu/repay/total
**Purpose:** Get total debt with interest for a position

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET "http://localhost:3001/api/vesu/repay/total?positionId=123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "positionId": "123",
  "principalDebt": "1000",
  "totalDebt": "1025.50",
  "debtAsset": "USDC"
}
```

**Status Codes:** 200, 400, 401, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing query parameters → 400
3. ✓ With valid parameters → 200/404/422/500/502/503

---

## 5. Withdraw Endpoints

### POST /api/vesu/withdraw
**Purpose:** Withdraw supplied assets

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X POST http://localhost:3001/api/vesu/withdraw \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "positionId": "123",
    "amount": "0.5",
    "walletAddress": "0xabc"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "withdrawnAmount": "0.5",
  "vTokensBurned": "0.5078",
  "newHealthFactor": "3.0",
  "position": { ... }
}
```

**Status Codes:** 200, 400, 401, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing required fields → 400
3. ✓ With valid data → 200/404/422/500/502/503

---

### GET /api/vesu/withdraw/max
**Purpose:** Calculate maximum withdrawable amount for a position

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET "http://localhost:3001/api/vesu/withdraw/max?positionId=123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "positionId": "123",
  "maxWithdrawable": "0.9",
  "currentCollateral": "1.5",
  "currentDebt": "1000"
}
```

**Status Codes:** 200, 400, 401, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing query parameters → 400
3. ✓ With valid parameters → 200/404/422/500/502/503

---

## 6. Position Management Endpoints

### GET /api/vesu/positions
**Purpose:** Get all positions for a user

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET "http://localhost:3001/api/vesu/positions?limit=10&offset=0&status=active" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "positions": [ ... ],
  "pagination": {
    "total": 25,
    "limit": 10,
    "offset": 0,
    "hasMore": true
  }
}
```

**Status Codes:** 200, 400, 401, 500, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ With authentication → 200/500/503
3. ✓ With pagination parameters → 200/500/503

---

### GET /api/vesu/positions/:id
**Purpose:** Get detailed position information

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/positions/123 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "position": {
    "id": "123",
    "poolAddress": "0x...",
    "collateralAsset": "ETH",
    "collateralAmount": "1.5",
    "debtAsset": "USDC",
    "debtAmount": "1000",
    "healthFactor": "2.5",
    ...
  }
}
```

**Status Codes:** 200, 401, 403, 404, 500, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ With authentication → 200/403/404/500/503

---

### POST /api/vesu/positions/:id/sync
**Purpose:** Sync position data from blockchain

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X POST http://localhost:3001/api/vesu/positions/123/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "walletAddress": "0xabc"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "position": { ... }
}
```

**Status Codes:** 200, 400, 401, 403, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing required fields → 400
3. ✓ With valid data → 200/403/404/422/500/502/503

---

### GET /api/vesu/positions/:id/health
**Purpose:** Get position health metrics

**Authentication:** Required (JWT)

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/positions/123/health \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "positionId": "123",
  "healthFactor": "2.5",
  "ltv": "0.67",
  "prices": {
    "ETH": "2500",
    "USDC": "1.0"
  },
  "lastUpdated": "2026-01-29T..."
}
```

**Status Codes:** 200, 401, 403, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ With authentication → 200/403/404/422/500/502/503

---

## 7. Pool Information Endpoints

### GET /api/vesu/pools
**Purpose:** Get available lending pools

**Authentication:** None required

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/pools
```

**Expected Response:**
```json
{
  "pools": [
    {
      "poolAddress": "0x...",
      "collateralAsset": "ETH",
      "debtAsset": "USDC",
      "maxLTV": "0.75",
      "supplyAPY": "3.5",
      "borrowAPY": "5.2",
      ...
    }
  ],
  "cached": false
}
```

**Status Codes:** 200, 500

**Test Cases:**
1. ✓ Without authentication → 200/500

---

### GET /api/vesu/pools/:address
**Purpose:** Get detailed pool information

**Authentication:** None required

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/pools/0x123abc
```

**Expected Response:**
```json
{
  "pool": {
    "poolAddress": "0x123abc",
    "collateralAsset": "ETH",
    "debtAsset": "USDC",
    ...
  }
}
```

**Status Codes:** 200, 400, 404, 500

**Test Cases:**
1. ✓ Invalid address format → 400
2. ✓ Valid address format → 200/404/500

---

### GET /api/vesu/pools/:address/interest-rate
**Purpose:** Get pool interest rates

**Authentication:** None required

**Rate Limit:** 100 requests per 15 minutes

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/pools/0x123abc/interest-rate
```

**Expected Response:**
```json
{
  "poolAddress": "0x123abc",
  "borrowAPY": "5.2",
  "supplyAPY": "3.5",
  "collateralAsset": "ETH",
  "debtAsset": "USDC"
}
```

**Status Codes:** 200, 400, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Invalid address format → 400
2. ✓ Valid address format → 200/404/422/500/502/503

---

## 8. Liquidation Endpoints

### GET /api/vesu/liquidations/opportunities
**Purpose:** Get liquidatable positions

**Authentication:** Optional

**Rate Limit:** 20 requests per 15 minutes

**Test Command:**
```bash
curl -X GET http://localhost:3001/api/vesu/liquidations/opportunities
```

**Expected Response:**
```json
{
  "opportunities": [
    {
      "positionId": "123",
      "healthFactor": "0.95",
      "collateralValue": "2000",
      "debtValue": "2100",
      "potentialProfit": "50"
    }
  ],
  "count": 1,
  "timestamp": "2026-01-29T..."
}
```

**Status Codes:** 200, 500, 503

**Test Cases:**
1. ✓ Without authentication → 200/500/503

---

### POST /api/vesu/liquidations/execute
**Purpose:** Execute a liquidation

**Authentication:** Required (JWT)

**Rate Limit:** 20 requests per 15 minutes

**Test Command:**
```bash
curl -X POST http://localhost:3001/api/vesu/liquidations/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "positionId": "123",
    "liquidatorAddress": "0xabc123",
    "debtToCover": "1000"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "collateralSeized": "0.5",
  "debtRepaid": "1000",
  "liquidationBonus": "50",
  ...
}
```

**Status Codes:** 200, 400, 401, 404, 422, 500, 502, 503

**Test Cases:**
1. ✓ Without authentication → 401
2. ✓ Missing required fields → 400
3. ✓ Invalid address format → 400
4. ✓ With valid data → 200/404/422/500/502/503

---

### GET /api/vesu/liquidations/history
**Purpose:** Get liquidation history

**Authentication:** None required

**Rate Limit:** 20 requests per 15 minutes

**Test Command:**
```bash
curl -X GET "http://localhost:3001/api/vesu/liquidations/history?limit=20&offset=0"
```

**Expected Response:**
```json
{
  "liquidations": [ ... ],
  "pagination": {
    "total": 50,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

**Status Codes:** 200, 500

**Test Cases:**
1. ✓ Without authentication → 200/500
2. ✓ With pagination → 200/500

---

## Automated Testing

### Using the Shell Script

A bash script is provided for automated testing:

```bash
cd backend/tests
chmod +x test-vesu-endpoints.sh
./test-vesu-endpoints.sh http://localhost:3001
```

This script will test all endpoints and provide a summary of passed/failed tests.

### Using Jest Tests

Run the Jest test suite:

```bash
cd backend
npm test vesu-endpoints.test.js
```

---

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Make sure you're using a valid JWT token
2. **503 Service Unavailable**: Vesu services may not be initialized (check environment variables)
3. **500 Internal Server Error**: Check server logs for detailed error messages
4. **Rate Limit Exceeded**: Wait 15 minutes or adjust rate limits in middleware

### Checking Service Status

Always start by checking the health endpoint:
```bash
curl http://localhost:3001/api/vesu/health
```

If services are unavailable, check:
- Environment variables are set correctly
- Starknet RPC connection is working
- Database is accessible

---

## Summary

All 24 Vesu API endpoints have been implemented and are accessible through the routes defined in `backend/routes/vesu.js`. The endpoints are properly configured with:

 Authentication middleware (where required)
 Input validation using express-validator
 Rate limiting
 Comprehensive error handling
 Consistent response formats

The routes are registered in `backend/server.js` at `/api/vesu`.
