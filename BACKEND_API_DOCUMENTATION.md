# EngiPay Backend API Documentation

## Overview
This document outlines all the API endpoints required to support the EngiPay Web3 payments and DeFi super app. The API should be built with RESTful principles and include proper authentication, error handling, and rate limiting.

## Authentication
All endpoints require wallet-based authentication using signed messages or JWT tokens derived from wallet signatures.

### Authentication Flow
1. Frontend requests nonce from `/auth/nonce`
2. User signs the nonce with their wallet
3. Frontend sends signed message to `/auth/verify`
4. Backend returns JWT token for subsequent requests

---

## API Endpoints

### Authentication Endpoints

#### POST `/auth/nonce`
Generate a nonce for wallet authentication.

**Request:**
```json
{
  "wallet_address": "0x1234...abcd"
}
```

**Response:**
```json
{
  "nonce": "Sign this message to authenticate: 1234567890",
  "expires_at": "2024-01-01T12:00:00Z"
}
```

#### POST `/auth/verify`
Verify signed message and return JWT token.

**Request:**
```json
{
  "wallet_address": "0x1234...abcd",
  "signature": "0x5678...efgh",
  "nonce": "Sign this message to authenticate: 1234567890"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "wallet_address": "0x1234...abcd",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

#### POST `/auth/refresh`
Refresh JWT token.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "token": "new_jwt_token_here"
}
```

---

### User Profile Endpoints

#### GET `/users/profile`
Get user profile information.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "id": "user_123",
  "wallet_address": "0x1234...abcd",
  "username": "crypto_user",
  "email": "user@example.com",
  "avatar_url": "https://...",
  "created_at": "2024-01-01T12:00:00Z",
  "last_login": "2024-01-15T10:30:00Z",
  "kyc_status": "verified",
  "settings": {
    "notifications": true,
    "currency": "USD",
    "language": "en"
  }
}
```

#### PUT `/users/profile`
Update user profile.

**Request:**
```json
{
  "username": "new_username",
  "email": "new_email@example.com",
  "settings": {
    "notifications": false,
    "currency": "EUR"
  }
}
```

#### PUT `/users/settings`
Update user settings.

**Request:**
```json
{
  "notifications": true,
  "currency": "USD",
  "language": "en",
  "theme": "dark",
  "two_factor_enabled": false
}
```

---

### Portfolio & Balance Endpoints

#### GET `/portfolio/balances`
Get user's portfolio balances across all assets.

**Query Parameters:**
- `chain` (optional): Filter by blockchain (ethereum, starknet, bitcoin)
- `include_zero` (optional): Include zero balance assets (default: false)

**Response:**
```json
{
  "total_value_usd": 6256.00,
  "total_change_24h": 2847.32,
  "assets": [
    {
      "symbol": "ETH",
      "name": "Ethereum",
      "balance": "1.234567",
      "value_usd": 2456.78,
      "change_24h": 2.5,
      "icon": "https://...",
      "chain": "ethereum",
      "contract_address": "0x0000000000000000000000000000000000000000"
    }
  ]
}
```

#### GET `/portfolio/history`
Get portfolio value history.

**Query Parameters:**
- `period`: "1d", "7d", "30d", "90d", "1y"
- `interval`: "1h", "1d", "1w" (depending on period)

**Response:**
```json
{
  "period": "30d",
  "interval": "1d",
  "data": [
    {
      "timestamp": "2024-01-01T00:00:00Z",
      "value_usd": 6000.00,
      "change_percent": 0.0
    }
  ]
}
```

#### GET `/portfolio/performance`
Get detailed portfolio performance metrics.

**Response:**
```json
{
  "total_return": 12.5,
  "total_return_usd": 750.00,
  "best_performer": {
    "symbol": "STRK",
    "change_percent": 25.3
  },
  "worst_performer": {
    "symbol": "USDC",
    "change_percent": -1.2
  },
  "asset_allocation": [
    {
      "asset": "ETH",
      "percentage": 40.0,
      "value_usd": 2500.00
    }
  ]
}
```

---

### Transaction & Activity Endpoints

#### GET `/transactions`
Get user's transaction history.

**Query Parameters:**
- `limit`: Number of transactions (default: 20, max: 100)
- `offset`: Pagination offset
- `type`: Filter by type (payment, swap, lending, staking, airdrop)
- `status`: Filter by status (pending, completed, failed)
- `start_date`: ISO date string
- `end_date`: ISO date string

**Response:**
```json
{
  "transactions": [
    {
      "id": "tx_123",
      "type": "payment",
      "description": "Payment to merchant",
      "amount": "0.1",
      "asset": "ETH",
      "value_usd": 200.00,
      "status": "completed",
      "timestamp": "2024-01-15T10:30:00Z",
      "tx_hash": "0x1234...abcd",
      "network": "ethereum",
      "to_address": "0xabcd...1234",
      "fee": "0.001",
      "fee_asset": "ETH"
    }
  ],
  "total_count": 150,
  "has_more": true
}
```

#### GET `/transactions/{id}`
Get detailed transaction information.

**Response:**
```json
{
  "id": "tx_123",
  "type": "swap",
  "status": "completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "network": "ethereum",
  "tx_hash": "0x1234...abcd",
  "from_asset": "ETH",
  "from_amount": "0.1",
  "to_asset": "USDC",
  "to_amount": "200.00",
  "exchange_rate": 2000.0,
  "fee": "0.001",
  "fee_asset": "ETH",
  "gas_used": "21000",
  "gas_price": "20",
  "block_number": "18500000",
  "confirmations": "12"
}
```

#### POST `/transactions/send`
Send a transaction (payment or transfer).

**Request:**
```json
{
  "to_address": "0xabcd...1234",
  "asset": "ETH",
  "amount": "0.1",
  "network": "ethereum",
  "gas_price": "20",
  "memo": "Payment for services"
}
```

**Response:**
```json
{
  "transaction_id": "tx_123",
  "tx_hash": "0x1234...abcd",
  "status": "pending",
  "estimated_completion": "2024-01-15T10:32:00Z"
}
```

---

### DeFi Operations Endpoints

#### GET `/defi/portfolio`
Get user's DeFi portfolio positions.

**Response:**
```json
{
  "total_value_locked": 4200.00,
  "total_apy": 8.6,
  "active_positions": 3,
  "positions": [
    {
      "protocol": "Vesu",
      "type": "lending",
      "asset": "ETH",
      "amount": "0.85",
      "value_usd": 1680.00,
      "apy": 4.2,
      "rewards_earned": 7.06,
      "status": "active",
      "lock_period": null,
      "start_date": "2024-01-01T00:00:00Z"
    }
  ]
}
```

#### GET `/defi/opportunities`
Get available DeFi opportunities.

**Query Parameters:**
- `type`: "lending", "staking", "farming", "liquidity"
- `asset`: Filter by asset
- `min_apy`: Minimum APY
- `max_risk`: Maximum risk level (1-5)

**Response:**
```json
{
  "opportunities": [
    {
      "id": "opp_123",
      "protocol": "Vesu",
      "type": "lending",
      "title": "ETH Lending Pool",
      "description": "Earn interest by lending ETH",
      "asset": "ETH",
      "apy": 4.2,
      "tvl": 1000000.00,
      "risk_level": 1,
      "minimum_deposit": 0.01,
      "lock_period_days": 0,
      "rewards": ["ETH"],
      "tags": ["low-risk", "stable"]
    }
  ]
}
```

#### POST `/defi/lend`
Lend assets to earn interest.

**Request:**
```json
{
  "protocol": "Vesu",
  "asset": "ETH",
  "amount": "0.5",
  "network": "ethereum"
}
```

**Response:**
```json
{
  "position_id": "pos_123",
  "transaction_hash": "0x1234...abcd",
  "estimated_apy": 4.2,
  "status": "pending"
}
```

#### POST `/defi/borrow`
Borrow assets against collateral.

**Request:**
```json
{
  "protocol": "Vesu",
  "collateral_asset": "ETH",
  "collateral_amount": "1.0",
  "borrow_asset": "USDC",
  "borrow_amount": "1500.00",
  "network": "ethereum"
}
```

**Response:**
```json
{
  "position_id": "pos_124",
  "transaction_hash": "0x1234...abcd",
  "health_factor": 2.1,
  "liquidation_price": 1800.00,
  "status": "pending"
}
```

#### POST `/defi/stake`
Stake assets for rewards.

**Request:**
```json
{
  "protocol": "Trove",
  "asset": "STRK",
  "amount": "1000",
  "pool_id": "pool_123",
  "lock_period_days": 30
}
```

#### POST `/defi/unstake`
Unstake assets from a position.

**Request:**
```json
{
  "position_id": "pos_123",
  "amount": "500"
}
```

#### GET `/defi/rewards`
Get available rewards for claiming.

**Response:**
```json
{
  "total_pending_rewards": 127.00,
  "rewards": [
    {
      "protocol": "Trove",
      "asset": "STRK",
      "amount": "25.50",
      "value_usd": 25.50,
      "claimable_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### POST `/defi/claim-rewards`
Claim pending rewards.

**Request:**
```json
{
  "protocol": "Trove",
  "asset": "STRK"
}
```

---

### Swap & Exchange Endpoints

#### GET `/swap/quote`
Get swap quote for token exchange.

**Query Parameters:**
- `from_asset`: Source asset symbol
- `to_asset`: Destination asset symbol
- `amount`: Amount to swap
- `slippage`: Maximum slippage percentage (default: 0.5)

**Response:**
```json
{
  "from_asset": "ETH",
  "to_asset": "USDC",
  "from_amount": "1.0",
  "to_amount": "2000.00",
  "exchange_rate": 2000.0,
  "price_impact": 0.1,
  "fee": "0.003",
  "fee_asset": "ETH",
  "estimated_gas": "150000",
  "routes": [
    {
      "protocol": "Uniswap V3",
      "percentage": 100,
      "path": ["ETH", "USDC"]
    }
  ]
}
```

#### POST `/swap`
Execute a token swap.

**Request:**
```json
{
  "from_asset": "ETH",
  "to_asset": "USDC",
  "from_amount": "1.0",
  "to_amount_min": "1990.00",
  "slippage": 0.5,
  "recipient_address": "0x1234...abcd"
}
```

**Response:**
```json
{
  "swap_id": "swap_123",
  "tx_hash": "0x1234...abcd",
  "status": "pending"
}
```

---

### Payment Endpoints

#### POST `/payments/send`
Send payment to another user or merchant.

**Request:**
```json
{
  "recipient": "0xabcd...1234",
  "asset": "ETH",
  "amount": "0.1",
  "memo": "Payment for coffee",
  "network": "ethereum"
}
```

#### GET `/payments/requests`
Get payment requests sent to user.

**Response:**
```json
{
  "requests": [
    {
      "id": "req_123",
      "from_address": "0xabcd...1234",
      "asset": "ETH",
      "amount": "0.5",
      "memo": "Invoice payment",
      "expires_at": "2024-01-20T00:00:00Z",
      "status": "pending"
    }
  ]
}
```

#### POST `/payments/request`
Create a payment request.

**Request:**
```json
{
  "asset": "ETH",
  "amount": "0.5",
  "memo": "Invoice payment",
  "expires_in_hours": 24
}
```

**Response:**
```json
{
  "request_id": "req_123",
  "payment_link": "https://engipay.com/pay/req_123"
}
```

---

### Analytics & Statistics Endpoints

#### GET `/analytics/portfolio`
Get portfolio analytics.

**Query Parameters:**
- `period`: "7d", "30d", "90d", "1y"

**Response:**
```json
{
  "period": "30d",
  "performance": {
    "total_return": 12.5,
    "volatility": 0.15,
    "sharpe_ratio": 1.8,
    "max_drawdown": -5.2
  },
  "asset_performance": [
    {
      "asset": "ETH",
      "return": 8.5,
      "allocation": 40.0
    }
  ]
}
```

#### GET `/analytics/defi`
Get DeFi analytics.

**Response:**
```json
{
  "total_value_locked": 4200.00,
  "total_rewards_earned": 150.00,
  "average_apy": 8.6,
  "protocols_used": ["Vesu", "Trove", "Endurfi"],
  "risk_distribution": {
    "low": 60,
    "medium": 30,
    "high": 10
  }
}
```

---

### Webhook Endpoints

#### POST `/webhooks/transaction-update`
Receive transaction status updates from blockchain.

**Request:**
```json
{
  "tx_hash": "0x1234...abcd",
  "status": "confirmed",
  "block_number": "18500000",
  "gas_used": "21000",
  "confirmations": "12"
}
```

#### POST `/webhooks/price-update`
Receive price updates for assets.

**Request:**
```json
{
  "asset": "ETH",
  "price_usd": 2000.00,
  "change_24h": 2.5,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## Error Handling

All endpoints should return appropriate HTTP status codes and error responses:

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance for transaction",
    "details": {
      "required": "0.1",
      "available": "0.05",
      "asset": "ETH"
    }
  }
}
```

## Rate Limiting

- Authentication endpoints: 10 requests per minute per IP
- Transaction endpoints: 100 requests per hour per user
- Read-only endpoints: 1000 requests per hour per user

## Security Considerations

1. All endpoints require proper authentication
2. Input validation and sanitization
3. Rate limiting and DDoS protection
4. API versioning
5. Comprehensive logging and monitoring
6. Encryption for sensitive data
7. CORS configuration for frontend access

## Database Schema Requirements

The backend will need the following main entities:
- Users (wallet addresses, profiles, settings)
- Transactions (payments, swaps, DeFi operations)
- Positions (lending, staking, farming positions)
- Assets (supported tokens and their metadata)
- Protocols (DeFi protocols and their configurations)
- Rewards (pending and claimed rewards)

## Implementation Priority

### Phase 1 (Core Authentication & Portfolio)
1. Authentication endpoints (`/auth/*`)
2. User profile endpoints (`/users/*`)
3. Portfolio endpoints (`/portfolio/*`)
4. Basic transaction history (`/transactions`)

### Phase 2 (DeFi Operations)
1. DeFi portfolio endpoints (`/defi/portfolio`)
2. DeFi opportunities (`/defi/opportunities`)
3. Basic DeFi operations (lend, stake)
4. Rewards claiming

### Phase 3 (Advanced Features)
1. Swap functionality (`/swap/*`)
2. Payment requests (`/payments/*`)
3. Analytics (`/analytics/*`)
4. Webhooks for real-time updates

This documentation covers all the endpoints needed to power the current EngiPay frontend functionality.


---

## Analytics Endpoints

### GET `/api/analytics/portfolio`
Get comprehensive portfolio analytics and performance metrics.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `period` (optional): Time period for analytics. Options: `1d`, `7d`, `30d`, `90d`, `1y`. Default: `30d`

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "30d",
    "total_value_usd": 5234.56,
    "total_return": 234.56,
    "total_return_percent": 4.69,
    "asset_allocation": [
      {
        "asset": "ETH",
        "percentage": 45.5,
        "value_usd": 2381.72
      },
      {
        "asset": "STRK",
        "percentage": 35.2,
        "value_usd": 1842.56
      }
    ],
    "performance_metrics": {
      "volatility": 0.15,
      "sharpe_ratio": 1.8,
      "max_drawdown": -5.2,
      "best_performer": {
        "asset": "STRK",
        "return_percent": 12.5
      },
      "worst_performer": {
        "asset": "BTC",
        "return_percent": -2.3
      }
    },
    "historical_values": [
      {
        "date": "2026-01-01",
        "value_usd": 5000.00
      }
    ]
  }
}
```

### GET `/api/analytics/defi`
Get DeFi activity analytics including TVL, rewards, and protocol usage.

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total_value_locked": 4200.00,
    "total_rewards_earned": 150.00,
    "average_apy": 8.6,
    "protocols_used": ["Vesu", "Trove", "Endurfi"],
    "active_positions": 3,
    "risk_distribution": {
      "low": 60,
      "medium": 30,
      "high": 10
    },
    "positions_by_protocol": [
      {
        "protocol": "Vesu",
        "tvl": 2500.00,
        "positions": 2,
        "apy": 9.2
      }
    ],
    "rewards_by_protocol": [
      {
        "protocol": "Vesu",
        "amount": 85.50,
        "asset": "STRK"
      }
    ]
  }
}
```

### GET `/api/analytics/transactions`
Get transaction analytics including volume, fees, and distribution.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `period` (optional): Time period for analytics. Options: `1d`, `7d`, `30d`, `90d`, `1y`. Default: `30d`

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "30d",
    "total_transactions": 45,
    "total_volume_usd": 12500.00,
    "average_transaction_size": 277.78,
    "total_fees_paid": 25.50,
    "transaction_types": {
      "send": 20,
      "receive": 15,
      "swap": 10
    },
    "networks_used": {
      "ethereum": 25,
      "starknet": 15,
      "bitcoin": 5
    },
    "success_rate": 97.8,
    "daily_volume": [
      {
        "date": "2026-01-01",
        "volume_usd": 450.00,
        "count": 3
      }
    ]
  }
}
```

### GET `/api/analytics/rewards`
Get rewards analytics including earned rewards and pending claims.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `period` (optional): Time period for analytics. Options: `1d`, `7d`, `30d`, `90d`, `1y`. Default: `30d`

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "30d",
    "total_rewards_earned": 150.00,
    "total_rewards_usd": 180.50,
    "pending_rewards": 25.00,
    "pending_rewards_usd": 30.00,
    "rewards_by_protocol": [
      {
        "protocol": "Vesu",
        "amount": 85.50,
        "asset": "STRK",
        "value_usd": 102.60
      }
    ],
    "rewards_by_asset": [
      {
        "asset": "STRK",
        "amount": 120.00,
        "value_usd": 144.00
      }
    ],
    "rewards_over_time": [
      {
        "date": "2026-01-01",
        "amount": 5.50,
        "value_usd": 6.60
      }
    ]
  }
}
```

### GET `/api/analytics/swaps`
Get swap analytics including volume, pairs, and success rates.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `period` (optional): Time period for analytics. Options: `1d`, `7d`, `30d`, `90d`, `1y`. Default: `30d`

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "30d",
    "total_swaps": 15,
    "total_volume_usd": 5000.00,
    "average_swap_size": 333.33,
    "total_fees_paid": 15.00,
    "success_rate": 100.0,
    "popular_pairs": [
      {
        "from_asset": "ETH",
        "to_asset": "STRK",
        "count": 8,
        "volume_usd": 3200.00
      }
    ],
    "swaps_by_protocol": [
      {
        "protocol": "Atomiq",
        "count": 15,
        "volume_usd": 5000.00
      }
    ],
    "daily_volume": [
      {
        "date": "2026-01-01",
        "volume_usd": 250.00,
        "count": 2
      }
    ]
  }
}
```

**Error Responses:**

All analytics endpoints return consistent error responses:

```json
{
  "success": false,
  "error": "Error message description"
}
```

**Status Codes:**
- `200 OK` - Successful request
- `401 Unauthorized` - Invalid or missing authentication token
- `500 Internal Server Error` - Server error occurred

**Notes:**
- All monetary values are in USD unless otherwise specified
- Percentages are returned as decimal numbers (e.g., 4.69 for 4.69%)
- Dates are in ISO 8601 format
- All endpoints require valid JWT authentication
- Data is user-specific and isolated per account
