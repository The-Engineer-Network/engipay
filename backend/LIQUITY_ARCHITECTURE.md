# Liquity Integration Architecture

Visual overview of the Liquity integration architecture in EngiPay backend.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         EngiPay Backend                          │
└─────────────────────────────────────────────────────────────────┘
                                │
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   API Layer  │      │   Services   │      │   Database   │
│              │      │              │      │              │
│ /api/liquity │◄────►│ LiquityService│◄────►│ PostgreSQL   │
│              │      │              │      │              │
│ - Routes     │      │ LiquityMonitor│      │ - Troves     │
│ - Validation │      │              │      │ - Transactions│
│ - Auth       │      │              │      │ - Deposits   │
└──────────────┘      └──────────────┘      └──────────────┘
                              │
                              │
                              ▼
                    ┌──────────────────┐
                    │  Ethereum Layer  │
                    │                  │
                    │ @liquity/lib-    │
                    │   ethers SDK     │
                    └──────────────────┘
                              │
                              │
                              ▼
                    ┌──────────────────┐
                    │ Ethereum Network │
                    │                  │
                    │ Liquity Protocol │
                    │   Contracts      │
                    └──────────────────┘
```

## Component Breakdown

### 1. API Layer (`routes/liquity.js`)

**Responsibilities:**
- HTTP endpoint handling
- Request validation
- Authentication
- Response formatting

**Endpoints:**
```
GET    /api/liquity/status
GET    /api/liquity/price
GET    /api/liquity/tcr
POST   /api/liquity/trove/open
POST   /api/liquity/trove/:id/close
POST   /api/liquity/trove/:id/adjust
GET    /api/liquity/trove/:id
GET    /api/liquity/troves
POST   /api/liquity/stability/deposit
POST   /api/liquity/stability/withdraw
GET    /api/liquity/transactions
```

### 2. Service Layer

#### LiquityService (`services/LiquityService.js`)

**Responsibilities:**
- Ethereum connection management
- Liquity SDK integration
- Transaction execution
- State queries
- Error handling

**Key Methods:**
```javascript
- initialize()
- getEthPrice()
- getTrove(address)
- openTrove(userId, collateral, debt)
- closeTrove(userId, troveId)
- adjustTrove(userId, troveId, params)
- depositToStabilityPool(userId, amount)
- withdrawFromStabilityPool(userId, amount)
- getTotalCollateralRatio()
```

#### LiquityMonitor (`services/LiquityMonitor.js`)

**Responsibilities:**
- Periodic health checks
- Risk assessment
- Alert generation
- Auto top-up execution
- Webhook notifications

**Key Methods:**
```javascript
- start()
- stop()
- checkAllTroves()
- checkTrove(trove)
- checkAlerts(trove, state)
- autoTopUp(trove, state)
- sendWebhookAlert(trove, level, message)
```

### 3. Data Layer

#### Models

**LiquityTrove** (`models/LiquityTrove.js`)
```javascript
{
  id: UUID,
  userId: UUID,
  ownerAddress: String,
  status: Enum,
  collateral: Decimal,
  debt: Decimal,
  collateralRatio: Decimal,
  ethPrice: Decimal,
  liquidationPrice: Decimal,
  healthScore: Decimal,
  riskLevel: Enum
}
```

**LiquityTransaction** (`models/LiquityTransaction.js`)
```javascript
{
  id: UUID,
  userId: UUID,
  troveId: UUID,
  txHash: String,
  type: Enum,
  status: Enum,
  ethAmount: Decimal,
  lusdAmount: Decimal,
  gasUsed: BigInt,
  beforeState: JSONB,
  afterState: JSONB
}
```

**LiquityStabilityDeposit** (`models/LiquityStabilityDeposit.js`)
```javascript
{
  id: UUID,
  userId: UUID,
  depositorAddress: String,
  depositAmount: Decimal,
  ethGainAccumulated: Decimal,
  lqtyRewardAccumulated: Decimal,
  status: Enum
}
```

### 4. External Integration

#### Liquity SDK (`@liquity/lib-ethers`)

**Provides:**
- Contract ABIs
- Type-safe interfaces
- Transaction builders
- State queries
- Event listeners

#### Ethereum Network

**Contracts:**
- BorrowerOperations
- TroveManager
- StabilityPool
- PriceFeed
- LUSDToken
- LQTYToken

## Data Flow Diagrams

### Opening a Trove

```
User Request
    │
    ▼
API Endpoint (/api/liquity/trove/open)
    │
    ├─► Validate Input
    ├─► Check Authentication
    ├─► Check Existing Trove
    │
    ▼
LiquityService.openTrove()
    │
    ├─► Calculate Expected CR
    ├─► Validate Parameters
    ├─► Get Current State
    │
    ▼
Liquity SDK
    │
    ├─► Build Transaction
    ├─► Sign Transaction
    ├─► Send to Network
    │
    ▼
Ethereum Network
    │
    ├─► Execute Contract
    ├─► Emit Events
    ├─► Update State
    │
    ▼
Transaction Receipt
    │
    ├─► Create Transaction Record
    ├─► Create Trove Record
    ├─► Calculate Health Metrics
    │
    ▼
Database
    │
    ▼
Response to User
```

### Monitoring Flow

```
Cron Schedule (Every 60s)
    │
    ▼
LiquityMonitor.checkAllTroves()
    │
    ├─► Query Active Troves from DB
    │
    ▼
For Each Trove:
    │
    ├─► LiquityService.getTrove(address)
    │       │
    │       ▼
    │   Ethereum Network
    │       │
    │       ▼
    │   Current State
    │
    ├─► Update Database Record
    ├─► Calculate Health Score
    ├─► Assess Risk Level
    │
    ▼
Check Alert Thresholds
    │
    ├─► CR < 120%? → Warning Alert
    ├─► CR < 115%? → Critical Alert
    │
    ▼
Generate Notifications
    │
    ├─► Create DB Notification
    ├─► Send Webhook (if configured)
    ├─► Increment Alert Counter
    │
    ▼
Auto Top-Up (if enabled)
    │
    ├─► CR < 130%?
    ├─► Calculate Required ETH
    ├─► Execute adjustTrove()
    ├─► Create Notification
    │
    ▼
Complete
```

### Transaction Processing

```
API Request
    │
    ▼
Service Layer
    │
    ├─► Get Current State (Before)
    │
    ▼
Build Transaction
    │
    ├─► Validate Parameters
    ├─► Calculate Gas
    ├─► Set Gas Price Limit
    │
    ▼
Create DB Transaction Record
    │
    ├─► Status: "pending"
    ├─► Store Before State
    │
    ▼
Execute on Blockchain
    │
    ├─► Sign Transaction
    ├─► Send to Network
    ├─► Wait for Confirmation
    │
    ▼
Process Receipt
    │
    ├─► Get New State (After)
    ├─► Update Transaction Record
    │   ├─► Status: "confirmed"/"failed"
    │   ├─► Gas Used
    │   ├─► Block Number
    │   └─► After State
    │
    ├─► Update Trove/Deposit Record
    │
    ▼
Return Result
```

## Configuration Flow

```
Environment Variables (.env)
    │
    ▼
liquity.config.js
    │
    ├─► Network Settings
    ├─► Contract Addresses
    ├─► Protocol Parameters
    ├─► Monitoring Config
    ├─► Gas Settings
    └─► Alert Config
    │
    ▼
Services (LiquityService, LiquityMonitor)
    │
    ▼
Runtime Configuration
```

## Security Architecture

```
┌─────────────────────────────────────────┐
│         Security Layers                  │
└─────────────────────────────────────────┘

1. API Layer
   ├─► Authentication (JWT)
   ├─► Rate Limiting
   ├─► Input Validation
   └─► CORS

2. Service Layer
   ├─► Private Key Management (env vars)
   ├─► Gas Price Limits
   ├─► Transaction Validation
   └─► Error Handling

3. Database Layer
   ├─► User Isolation
   ├─► Prepared Statements
   └─► Access Control

4. Blockchain Layer
   ├─► Transaction Signing
   ├─► Nonce Management
   └─► Confirmation Waiting
```

## Monitoring Architecture

```
┌─────────────────────────────────────────┐
│      Monitoring Components               │
└─────────────────────────────────────────┘

Cron Job (60s interval)
    │
    ▼
Health Check Service
    │
    ├─► Query Database
    ├─► Query Blockchain
    ├─► Calculate Metrics
    │
    ▼
Risk Assessment
    │
    ├─► Collateral Ratio
    ├─► Health Score
    ├─► Risk Level
    │
    ▼
Alert System
    │
    ├─► Database Notifications
    ├─► Webhook Delivery
    └─► Email (optional)
    │
    ▼
Auto Response (optional)
    │
    └─► Auto Top-Up
```

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│      Production Environment              │
└─────────────────────────────────────────┘

Load Balancer
    │
    ▼
Application Servers (Node.js)
    │
    ├─► Express Server
    ├─► Liquity Services
    └─► Monitoring Service
    │
    ▼
Database Cluster (PostgreSQL)
    │
    ├─► Primary
    └─► Replicas
    │
    ▼
Cache Layer (Redis)
    │
    └─► Session Storage
    │
    ▼
External Services
    │
    ├─► Ethereum RPC (Alchemy/Infura)
    ├─► Webhook Endpoints
    └─► Email Service
```

## Error Handling Flow

```
Error Occurs
    │
    ▼
Catch Block
    │
    ├─► Log Error Details
    ├─► Classify Error Type
    │   ├─► Validation Error
    │   ├─► Network Error
    │   ├─► Contract Error
    │   └─► System Error
    │
    ▼
Update Transaction Status
    │
    ├─► Mark as "failed"
    ├─► Store Error Message
    │
    ▼
Notify User
    │
    ├─► API Response
    └─► Notification (if critical)
    │
    ▼
Recovery Action (if applicable)
    │
    ├─► Retry Logic
    ├─► Fallback Action
    └─► Manual Intervention
```

## Performance Considerations

### Optimization Points

1. **Database Queries**
   - Indexed fields: userId, ownerAddress, status
   - Connection pooling
   - Query optimization

2. **Blockchain Calls**
   - Batch requests when possible
   - Cache ETH price (short TTL)
   - Efficient gas estimation

3. **Monitoring**
   - Parallel Trove checks
   - Configurable intervals
   - Conditional updates

4. **API Responses**
   - Pagination for lists
   - Selective field returns
   - Response caching (where appropriate)

## Scalability Architecture

```
Horizontal Scaling
    │
    ├─► Multiple API Servers
    │   └─► Load Balanced
    │
    ├─► Database Replication
    │   ├─► Read Replicas
    │   └─► Write Primary
    │
    ├─► Monitoring Distribution
    │   └─► Trove Sharding
    │
    └─► Cache Layer
        └─► Redis Cluster
```

## Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API | Express.js | HTTP server |
| Validation | express-validator | Input validation |
| Auth | JWT | Authentication |
| Database | PostgreSQL + Sequelize | Data persistence |
| Blockchain | ethers.js | Ethereum interaction |
| Protocol | @liquity/lib-ethers | Liquity SDK |
| Scheduling | node-cron | Monitoring jobs |
| Security | Helmet, CORS | API security |

## Integration Points

### Internal
- User authentication system
- Notification system
- Transaction history
- Portfolio tracking

### External
- Ethereum network (mainnet/testnet)
- Liquity protocol contracts
- RPC providers (Alchemy/Infura)
- Webhook endpoints
- Email service (optional)

---

This architecture provides a robust, scalable, and secure integration with the Liquity protocol while maintaining separation of concerns and following best practices.
