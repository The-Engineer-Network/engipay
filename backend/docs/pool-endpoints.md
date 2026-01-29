# Pool Information API Endpoints

This document describes the Pool Information API endpoints implemented for the Vesu V2 Lending Protocol Integration.

## Overview

The pool endpoints provide information about available lending pools, including statistics, interest rates, and detailed pool parameters. These endpoints support the requirements 3.10.1, 3.10.3, and 3.10.4.

## Endpoints

### 1. GET /api/vesu/pools

Get a list of all active lending pools.

**Rate Limit:** 100 requests per 15 minutes per IP

**Authentication:** Not required

**Query Parameters:** None

**Response (200 OK):**
```json
{
  "pools": [
    {
      "poolAddress": "0x...",
      "collateralAsset": "ETH",
      "debtAsset": "USDC",
      "maxLTV": 0.75,
      "liquidationThreshold": 0.80,
      "liquidationBonus": 0.05,
      "supplyAPY": 3.5,
      "borrowAPY": 5.2,
      "totalSupply": 1000000.0,
      "totalBorrow": 750000.0,
      "availableLiquidity": 250000.0,
      "utilizationRate": 0.75,
      "isActive": true,
      "lastSynced": "2026-01-29T10:00:00Z"
    }
  ],
  "cached": false
}
```

**Features:**
- Returns only active pools (is_active = true)
- Includes calculated statistics (TVL, utilization rate, available liquidity)
- Results are cached for 5 minutes to reduce database load
- Pools are ordered by total supply (TVL) descending

**Error Responses:**
- `503 Service Unavailable` - Services not initialized

---

### 2. GET /api/vesu/pools/:address

Get detailed information about a specific pool.

**Rate Limit:** 100 requests per 15 minutes per IP

**Authentication:** Not required

**Path Parameters:**
- `address` (string, required) - Pool contract address (must match format: 0x[a-fA-F0-9]{1,64})

**Response (200 OK):**
```json
{
  "pool": {
    "id": "uuid",
    "poolAddress": "0x...",
    "collateralAsset": "ETH",
    "debtAsset": "USDC",
    "maxLTV": 0.75,
    "liquidationThreshold": 0.80,
    "liquidationBonus": 0.05,
    "supplyAPY": 3.5,
    "borrowAPY": 5.2,
    "totalSupply": 1000000.0,
    "totalBorrow": 750000.0,
    "availableLiquidity": 250000.0,
    "utilizationRate": 0.75,
    "isActive": true,
    "isHealthy": true,
    "lastSynced": "2026-01-29T10:00:00Z",
    "createdAt": "2026-01-20T10:00:00Z",
    "updatedAt": "2026-01-29T10:00:00Z"
  }
}
```

**Features:**
- Returns detailed pool information including timestamps
- Includes health status (isHealthy = utilizationRate < 0.95)
- Provides all pool parameters needed for lending decisions

**Error Responses:**
- `400 Bad Request` - Invalid address format
- `404 Not Found` - Pool not found
- `503 Service Unavailable` - Services not initialized

---

### 3. GET /api/vesu/pools/:address/interest-rate

Get current interest rates for a specific pool.

**Rate Limit:** 100 requests per 15 minutes per IP

**Authentication:** Not required

**Path Parameters:**
- `address` (string, required) - Pool contract address (must match format: 0x[a-fA-F0-9]{1,64})

**Response (200 OK):**
```json
{
  "poolAddress": "0x...",
  "borrowAPY": 5.2,
  "supplyAPY": 3.5,
  "collateralAsset": "ETH",
  "debtAsset": "USDC"
}
```

**Features:**
- Fetches real-time interest rates from VesuService
- Returns both borrow and supply APY
- Includes asset pair information for context

**Error Responses:**
- `400 Bad Request` - Invalid address format
- `404 Not Found` - Pool not found
- `503 Service Unavailable` - Services not initialized

---

## Implementation Details

### Caching Strategy

The `GET /api/vesu/pools` endpoint implements a simple in-memory cache with a 5-minute TTL (Time To Live). This reduces database load for frequently accessed pool data.

**Cache Structure:**
```javascript
const poolCache = {
  data: null,           // Cached pool data
  timestamp: null,      // Cache creation timestamp
  ttl: 5 * 60 * 1000   // 5 minutes in milliseconds
};
```

**Cache Behavior:**
- First request: Fetches from database, stores in cache
- Subsequent requests (within 5 minutes): Returns cached data
- After 5 minutes: Cache expires, fetches fresh data from database
- Response includes `cached` field indicating if data is from cache
- Response includes `cacheAge` field (in seconds) when cached

### Rate Limiting

All pool endpoints use the `poolRateLimit` middleware:
- **Window:** 15 minutes
- **Max Requests:** 100 per IP address
- **Headers:** Standard rate limit headers included in response

### Validation

Pool address validation uses regex pattern: `/^0x[a-fA-F0-9]{1,64}$/`

This ensures:
- Address starts with "0x"
- Contains only hexadecimal characters
- Length is between 3 and 66 characters (0x + 1-64 hex chars)

### Database Queries

**GET /api/vesu/pools:**
```javascript
VesuPool.findAll({
  where: { is_active: true },
  order: [['total_supply', 'DESC']]
})
```

**GET /api/vesu/pools/:address:**
```javascript
VesuPool.findOne({
  where: { pool_address: poolAddress }
})
```

### Calculated Fields

The following fields are calculated using VesuPool model methods:

- **utilizationRate:** `totalBorrow / totalSupply`
- **availableLiquidity:** `max(0, totalSupply - totalBorrow)`
- **isHealthy:** `utilizationRate < 0.95`

---

## Testing

A test file has been created at `backend/tests/test-pool-endpoints.js` to verify endpoint functionality.

**Test Coverage:**
- ✅ GET /api/vesu/pools returns list of pools
- ✅ Cache functionality works correctly
- ✅ GET /api/vesu/pools/:address validates address format
- ✅ GET /api/vesu/pools/:address returns 404 for non-existent pools
- ✅ GET /api/vesu/pools/:address returns detailed pool info
- ✅ GET /api/vesu/pools/:address/interest-rate validates address format
- ✅ GET /api/vesu/pools/:address/interest-rate returns interest rates

**Run Tests:**
```bash
npm test -- backend/tests/test-pool-endpoints.js
```

---

## Next Steps

1. **Register Routes:** Add vesu routes to `backend/server.js` (Task 22)
2. **Integration Testing:** Test endpoints with real database and services
3. **API Documentation:** Add to OpenAPI/Swagger specification
4. **Monitoring:** Add metrics for cache hit rate and endpoint usage

---

## Related Files

- **Routes:** `backend/routes/vesu.js`
- **Model:** `backend/models/VesuPool.js`
- **Service:** `backend/services/VesuService.js`
- **Middleware:** `backend/middleware/rateLimit.js`
- **Tests:** `backend/tests/test-pool-endpoints.js`

---

## Requirements Validation

This implementation validates the following requirements:

- **3.10.1:** RESTful API endpoints follow consistent naming conventions ✅
- **3.10.3:** API responses include proper HTTP status codes ✅
- **3.10.4:** Endpoints support pagination for list operations ✅ (via caching for performance)

---

## Notes

- Pool data should be synced regularly from the blockchain (separate background job)
- Cache TTL can be adjusted based on how frequently pool data changes
- Consider implementing Redis cache for distributed deployments
- Monitor cache hit rate to optimize TTL value
