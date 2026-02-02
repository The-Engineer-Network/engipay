# Liquity Protocol Integration Guide

Complete guide for the Liquity V1 protocol integration in EngiPay backend.

## Overview

Liquity is a decentralized borrowing protocol that allows users to draw interest-free loans against ETH collateral. The integration provides:

- **Trove Management**: Open, close, and adjust borrowing positions
- **Stability Pool**: Deposit LUSD to earn liquidation gains and LQTY rewards
- **Real-time Monitoring**: Automated health checks and liquidation alerts
- **Risk Management**: Collateral ratio tracking and auto top-up features

## Prerequisites

### 1. Install Dependencies

```bash
cd backend
npm install @liquity/lib-ethers ethers@6
```

### 2. Environment Configuration

Add to `backend/.env`:

```env
# Ethereum Configuration
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY
ETHEREUM_PRIVATE_KEY=your_private_key_here

# Liquity Configuration
LIQUITY_NETWORK=mainnet  # or 'goerli', 'sepolia'

# Monitoring
LIQUITY_AUTO_TOPUP=false
LIQUITY_ALERTS_ENABLED=true
LIQUITY_WEBHOOK_URL=https://your-webhook-url.com/alerts

# Gas Settings
MAX_GAS_PRICE=100  # in gwei
```

### 3. Database Setup

The Liquity models are already defined. Sync the database:

```bash
npm run sync-db
```

This creates the following tables:
- `liquity_troves` - Trove positions
- `liquity_transactions` - Transaction history
- `liquity_stability_deposits` - Stability Pool deposits

## Core Concepts

### Trove (Borrowing Position)

A Trove is a collateralized debt position where:
- **Collateral**: ETH deposited
- **Debt**: LUSD borrowed
- **Collateral Ratio**: (ETH Value / LUSD Debt) × 100

**Key Parameters:**
- Minimum Collateral Ratio: 110%
- Minimum Debt: 2,000 LUSD
- Liquidation Reserve: 200 LUSD (returned when closed)
- Borrowing Fee: 0.5% - 5% (one-time)

### Risk Levels

| Collateral Ratio | Risk Level | Description |
|-----------------|------------|-------------|
| ≥ 250% | Safe | Conservative position |
| 150-250% | Safe | Recommended range |
| 130-150% | Moderate | Monitor closely |
| 120-130% | Warning | Add collateral soon |
| 115-120% | Critical | Liquidation risk |
| < 115% | Liquidation | Immediate action needed |

### Recovery Mode

When Total Collateral Ratio (TCR) < 150%, the system enters Recovery Mode:
- More aggressive liquidations
- Different liquidation rules apply
- Higher risk for all Troves

## API Endpoints

### Status & Information

#### Get Service Status
```http
GET /api/liquity/status
```

Response:
```json
{
  "success": true,
  "data": {
    "initialized": true,
    "ethPrice": 2500.50,
    "totalCollateralRatio": {
      "totalCollateral": 1000000,
      "totalDebt": 500000000,
      "tcr": 5.0,
      "recoveryMode": false
    },
    "monitoring": {
      "isRunning": true,
      "checkInterval": 60000
    }
  }
}
```

#### Get ETH Price
```http
GET /api/liquity/price
```

#### Get Total Collateral Ratio
```http
GET /api/liquity/tcr
```

### Trove Operations

#### Open Trove
```http
POST /api/liquity/trove/open
Authorization: Bearer <token>
Content-Type: application/json

{
  "depositCollateral": 5.0,
  "borrowLUSD": 5000,
  "maxBorrowingRate": 0.05
}
```

**Validation:**
- `depositCollateral`: Minimum 0.01 ETH
- `borrowLUSD`: Minimum 2000 LUSD
- `maxBorrowingRate`: 0.005 - 0.05 (0.5% - 5%)

Response:
```json
{
  "success": true,
  "data": {
    "trove": {
      "id": "uuid",
      "ownerAddress": "0x...",
      "collateral": 5.0,
      "debt": 5025,
      "collateralRatio": 2.49,
      "status": "active"
    },
    "transaction": {
      "txHash": "0x...",
      "type": "open_trove",
      "status": "confirmed"
    }
  }
}
```

#### Close Trove
```http
POST /api/liquity/trove/:troveId/close
Authorization: Bearer <token>
```

**Requirements:**
- Must have sufficient LUSD to repay debt
- Trove must be active

#### Adjust Trove
```http
POST /api/liquity/trove/:troveId/adjust
Authorization: Bearer <token>
Content-Type: application/json

{
  "depositCollateral": 1.0,
  "withdrawCollateral": 0,
  "borrowLUSD": 1000,
  "repayLUSD": 0
}
```

**Operations:**
- Add collateral: `depositCollateral`
- Remove collateral: `withdrawCollateral`
- Borrow more: `borrowLUSD`
- Repay debt: `repayLUSD`

#### Get Trove Details
```http
GET /api/liquity/trove/:troveId
Authorization: Bearer <token>
```

#### Get All User Troves
```http
GET /api/liquity/troves?status=active
Authorization: Bearer <token>
```

Query params:
- `status`: Filter by status (active, closed, liquidated)

#### Manual Health Check
```http
POST /api/liquity/trove/:troveId/check
Authorization: Bearer <token>
```

### Stability Pool

#### Deposit LUSD
```http
POST /api/liquity/stability/deposit
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 10000
}
```

**Benefits:**
- Earn ETH from liquidations
- Earn LQTY rewards
- Help stabilize the protocol

#### Withdraw LUSD
```http
POST /api/liquity/stability/withdraw
Authorization: Bearer <token>
Content-Type: application/json

{
  "amount": 5000
}
```

#### Get Deposit Info
```http
GET /api/liquity/stability/deposit
Authorization: Bearer <token>
```

Response:
```json
{
  "success": true,
  "data": {
    "deposit": {
      "depositAmount": 10000,
      "ethGainAccumulated": 0.5,
      "lqtyRewardAccumulated": 100
    },
    "currentState": {
      "currentLUSD": 9800,
      "collateralGain": 0.5,
      "lqtyReward": 100
    }
  }
}
```

### Transactions

#### Get Transaction History
```http
GET /api/liquity/transactions?type=open_trove&limit=50&offset=0
Authorization: Bearer <token>
```

Query params:
- `type`: Filter by transaction type
- `status`: Filter by status (pending, confirmed, failed)
- `limit`: Results per page (default: 50)
- `offset`: Pagination offset

## Monitoring Service

The Liquity Monitor automatically checks Trove health and sends alerts.

### Features

1. **Periodic Health Checks**: Every 60 seconds
2. **Risk Assessment**: Calculates health score and risk level
3. **Automated Alerts**: Notifications for liquidation risks
4. **Auto Top-Up**: Optional automatic collateral addition
5. **Webhook Integration**: External alert system support

### Starting the Monitor

The monitor starts automatically with the server. To control manually:

```javascript
const liquityMonitor = require('./services/LiquityMonitor');

// Start monitoring
liquityMonitor.start();

// Stop monitoring
liquityMonitor.stop();

// Get status
const status = liquityMonitor.getStatus();
```

### Alert Thresholds

Configured in `liquity.config.js`:

```javascript
monitoring: {
  checkInterval: 60000,              // 60 seconds
  liquidationWarningThreshold: 1.2,  // 120% CR
  criticalThreshold: 1.15,           // 115% CR
  autoTopUpEnabled: false,
  autoTopUpThreshold: 1.3,           // 130% CR
  autoTopUpTarget: 1.8,              // 180% CR target
}
```

### Alert Levels

- **Warning**: CR < 120% - Monitor closely
- **Critical**: CR < 115% - Immediate action needed

## Usage Examples

### Example 1: Open a Conservative Trove

```javascript
// Deposit 10 ETH, borrow 10,000 LUSD
// At ETH price $2,500: CR = (10 * 2500) / 10000 = 250%

POST /api/liquity/trove/open
{
  "depositCollateral": 10.0,
  "borrowLUSD": 10000,
  "maxBorrowingRate": 0.05
}
```

### Example 2: Add Collateral to Improve Health

```javascript
// Add 2 ETH to existing Trove

POST /api/liquity/trove/:troveId/adjust
{
  "depositCollateral": 2.0
}
```

### Example 3: Partial Debt Repayment

```javascript
// Repay 5,000 LUSD

POST /api/liquity/trove/:troveId/adjust
{
  "repayLUSD": 5000
}
```

### Example 4: Earn from Stability Pool

```javascript
// 1. Deposit LUSD
POST /api/liquity/stability/deposit
{
  "amount": 50000
}

// 2. Check rewards periodically
GET /api/liquity/stability/deposit

// 3. Withdraw with gains
POST /api/liquity/stability/withdraw
{
  "amount": 50000
}
```

## Service Architecture

### LiquityService

Core service for blockchain interactions:
- Connects to Liquity contracts via SDK
- Executes Trove operations
- Manages transactions
- Queries on-chain state

### LiquityMonitor

Background monitoring service:
- Periodic health checks
- Risk assessment
- Alert generation
- Auto top-up execution

### Models

**LiquityTrove**
- Stores Trove state
- Calculates health metrics
- Tracks risk levels

**LiquityTransaction**
- Records all operations
- Tracks gas costs
- Stores before/after states

**LiquityStabilityDeposit**
- Tracks pool deposits
- Records rewards
- Monitors gains

## Error Handling

Common errors and solutions:

### "Minimum debt is 2000 LUSD"
- Borrow at least 2,000 LUSD when opening Trove

### "Collateral ratio below minimum"
- Increase collateral or reduce borrow amount
- Minimum CR is 110%

### "User already has an active Trove"
- Each address can only have one Trove
- Close existing Trove first

### "Insufficient LUSD balance"
- Ensure wallet has enough LUSD to repay debt

### "Transaction reverted"
- Check gas price settings
- Verify wallet has sufficient ETH for gas
- Ensure operation doesn't violate protocol rules

## Testing

### Test Scripts

```bash
# Test Liquity connection
node scripts/test-liquity-connection.js

# Test Trove operations
node scripts/test-trove-operations.js

# Test monitoring
node scripts/test-liquity-monitor.js
```

### Manual Testing

1. **Testnet First**: Always test on Goerli/Sepolia before mainnet
2. **Small Amounts**: Start with minimum values
3. **Monitor Closely**: Watch collateral ratio changes
4. **Test Recovery**: Practice adding collateral

## Security Considerations

1. **Private Key Management**
   - Never commit private keys
   - Use environment variables
   - Consider hardware wallets for production

2. **Gas Price Limits**
   - Set `MAX_GAS_PRICE` to prevent overpaying
   - Monitor gas costs

3. **Collateral Ratio Buffer**
   - Maintain CR well above 110%
   - Recommended: 150-200% minimum

4. **Recovery Mode Awareness**
   - Monitor TCR regularly
   - Be prepared for Recovery Mode

5. **Redemption Risk**
   - Low CR Troves are redeemed first
   - Maintain higher CR to avoid redemptions

## Monitoring & Alerts

### Webhook Integration

Configure webhook URL in `.env`:

```env
LIQUITY_WEBHOOK_URL=https://your-webhook.com/alerts
```

Webhook payload:
```json
{
  "event": "liquity_alert",
  "level": "critical",
  "message": "Trove near liquidation! CR: 115.50%",
  "trove": {
    "id": "uuid",
    "ownerAddress": "0x...",
    "collateralRatio": 1.155,
    "collateral": 5.0,
    "debt": 10000,
    "ethPrice": 2310,
    "liquidationPrice": 2200
  },
  "timestamp": "2026-02-02T10:30:00Z"
}
```

### Database Notifications

Alerts are stored in the `notifications` table:

```sql
SELECT * FROM notifications 
WHERE type = 'liquity_alert' 
AND user_id = 'user-uuid'
ORDER BY created_at DESC;
```

## Best Practices

1. **Conservative Collateral Ratios**
   - Start with 200%+ CR
   - Never go below 150% CR
   - Monitor ETH price volatility

2. **Regular Monitoring**
   - Check Trove health daily
   - Enable alerts
   - Set up webhooks

3. **Gradual Adjustments**
   - Make small, incremental changes
   - Test on testnet first
   - Understand gas costs

4. **Emergency Preparedness**
   - Keep extra ETH for collateral
   - Have LUSD ready for repayment
   - Know how to close quickly

5. **Stability Pool Strategy**
   - Diversify between Trove and Pool
   - Monitor pool share
   - Claim rewards regularly

## Troubleshooting

### Service Won't Initialize

Check:
- `ETHEREUM_RPC_URL` is valid
- `ETHEREUM_PRIVATE_KEY` is set
- Network is correct (mainnet/testnet)
- RPC endpoint is accessible

### Transactions Failing

Check:
- Wallet has sufficient ETH for gas
- Gas price is reasonable
- Operation parameters are valid
- Trove state allows operation

### Monitor Not Running

Check:
- Service started successfully
- No initialization errors
- Database connection working
- Cron job scheduled

## Resources

- **Liquity Docs**: https://docs.liquity.org/
- **SDK Docs**: https://github.com/liquity/dev/tree/main/docs/sdk
- **GitHub**: https://github.com/liquity/dev
- **NPM Package**: https://www.npmjs.com/package/@liquity/lib-ethers
- **Discord**: Available through official website

## Support

For issues or questions:
1. Check this documentation
2. Review error messages
3. Test on testnet
4. Check Liquity Discord
5. Review GitHub issues

## License

MIT
