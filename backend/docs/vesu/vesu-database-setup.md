# Vesu Database Setup Guide

This guide explains how to set up and use the Vesu lending integration database schema.

## Overview

The Vesu integration uses 4 main database tables:
1. **vesu_pools** - Lending pool configurations
2. **vesu_positions** - User lending positions
3. **vesu_transactions** - Transaction history
4. **vesu_liquidations** - Liquidation events

## Prerequisites

- PostgreSQL 12+ installed and running
- Node.js 16+ installed
- Database credentials configured in `.env` file

## Environment Variables

Add these to your `backend/.env` file:

```env
# Database Configuration
DB_NAME=engipay_db
DB_USER=engipay_user
DB_PASSWORD=your_secure_password_here
DB_HOST=localhost
DB_PORT=5432
DB_SSL=false

# Pool settings (optional)
DB_POOL_MAX=10
DB_POOL_MIN=2
DB_POOL_ACQUIRE=30000
DB_POOL_IDLE=10000
```

## Installation Steps

### Step 1: Install Dependencies

```bash
cd backend
npm install
```

### Step 2: Create Database

If you haven't created the database yet:

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database and user
CREATE DATABASE engipay_db;
CREATE USER engipay_user WITH PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE engipay_db TO engipay_user;
\q
```

### Step 3: Run Migrations

Run the migration script to create all Vesu tables and indexes:

```bash
npm run migrate
```

This will create:
- All 4 Vesu tables
- All indexes for performance optimization
- Foreign key relationships

### Step 4: Verify Setup

Verify that all indexes were created correctly:

```bash
npm run verify-indexes
```

Expected output:
```
All expected indexes are present!
```

## Database Schema

### VesuPool Table

Stores lending pool configurations.

**Key Fields:**
- `pool_address` - Unique Starknet contract address
- `collateral_asset` / `debt_asset` - Asset pair (e.g., ETH/USDC)
- `max_ltv` - Maximum loan-to-value ratio
- `liquidation_threshold` - When positions become liquidatable
- `total_supply` / `total_borrow` - Pool liquidity metrics

### VesuPosition Table

Tracks user lending positions.

**Key Fields:**
- `user_id` - Reference to User table
- `pool_address` - Which pool this position is in
- `collateral_amount` - Amount of collateral supplied
- `debt_amount` - Amount borrowed
- `vtoken_balance` - ERC-4626 vToken balance
- `health_factor` - Position health (collateral/debt ratio)
- `status` - active, liquidated, or closed

### VesuTransaction Table

Records all Vesu operations.

**Key Fields:**
- `transaction_hash` - Unique Starknet tx hash
- `type` - supply, borrow, repay, withdraw, liquidation
- `asset` - Which asset was involved
- `amount` - Transaction amount
- `status` - pending, confirmed, failed

### VesuLiquidation Table

Tracks liquidation events.

**Key Fields:**
- `position_id` - Which position was liquidated
- `liquidator_address` - Who performed the liquidation
- `collateral_seized` - Amount of collateral taken
- `debt_repaid` - Amount of debt covered
- `liquidation_bonus` - Bonus earned by liquidator

## Usage Examples

### Creating a Pool Record

```javascript
const { VesuPool } = require('./models');

const pool = await VesuPool.create({
  pool_address: '0x1234...',
  collateral_asset: 'ETH',
  debt_asset: 'USDC',
  max_ltv: 0.75,
  liquidation_threshold: 0.80,
  liquidation_bonus: 0.05,
  total_supply: 1000000,
  total_borrow: 750000,
  supply_apy: 0.035,
  borrow_apy: 0.052,
  is_active: true,
});
```

### Creating a Position

```javascript
const { VesuPosition } = require('./models');

const position = await VesuPosition.create({
  user_id: 'user-uuid',
  pool_address: '0x1234...',
  collateral_asset: 'ETH',
  debt_asset: 'USDC',
  collateral_amount: 1.5,
  debt_amount: 1000,
  vtoken_balance: 1.5234,
  health_factor: 2.5,
  status: 'active',
});
```

### Finding Liquidatable Positions

```javascript
const { VesuPosition } = require('./models');

const liquidatable = await VesuPosition.findLiquidatablePositions();
// Returns all positions with health_factor < 1.0
```

### Getting User Positions

```javascript
const { VesuPosition } = require('./models');

const positions = await VesuPosition.findUserPositions(userId, 'active');
// Returns all active positions for a user
```

### Recording a Transaction

```javascript
const { VesuTransaction } = require('./models');

const tx = await VesuTransaction.create({
  position_id: 'position-uuid',
  user_id: 'user-uuid',
  transaction_hash: '0xabcd...',
  type: 'borrow',
  asset: 'USDC',
  amount: 1000,
  status: 'pending',
});

// Later, update when confirmed
await tx.update({
  status: 'confirmed',
  block_number: 123456,
  timestamp: new Date(),
  gas_used: 0.001,
});
```

## Model Methods

### VesuPosition Methods

**Instance Methods:**
- `isHealthy()` - Returns true if health_factor >= 1.0
- `isAtRisk()` - Returns true if 1.0 <= health_factor < 1.2
- `isCritical()` - Returns true if 1.0 <= health_factor < 1.05
- `isLiquidatable()` - Returns true if health_factor < 1.0
- `hasDebt()` - Returns true if debt_amount > 0
- `hasCollateral()` - Returns true if collateral_amount > 0

**Static Methods:**
- `findActivePositions()` - Get all active positions
- `findLiquidatablePositions()` - Get positions with health_factor < 1.0
- `findAtRiskPositions()` - Get positions with 1.0 <= health_factor < 1.2
- `findUserPositions(userId, status)` - Get user's positions

### VesuPool Methods

**Instance Methods:**
- `getUtilizationRate()` - Returns total_borrow / total_supply
- `getAvailableLiquidity()` - Returns total_supply - total_borrow
- `isHealthy()` - Returns true if utilization < 95%
- `canBorrow(amount)` - Check if amount can be borrowed
- `needsSync(maxAgeMinutes)` - Check if pool data is stale

**Static Methods:**
- `findByAddress(poolAddress)` - Find pool by contract address
- `findActivePools()` - Get all active pools
- `findByAssetPair(collateral, debt)` - Find pool by asset pair
- `findPoolsNeedingSync(maxAgeMinutes)` - Get stale pools
- `getPoolStats()` - Get aggregate statistics

### VesuTransaction Methods

**Instance Methods:**
- `isPending()`, `isConfirmed()`, `isFailed()` - Check status
- `isSupply()`, `isBorrow()`, `isRepay()`, `isWithdraw()`, `isLiquidation()` - Check type

**Static Methods:**
- `findByHash(txHash)` - Find transaction by hash
- `findPendingTransactions()` - Get all pending transactions
- `findUserTransactions(userId, type, limit)` - Get user's transactions
- `findPositionTransactions(positionId)` - Get position's transactions
- `getTransactionStats(userId, startDate, endDate)` - Get statistics

### VesuLiquidation Methods

**Instance Methods:**
- `getLiquidationProfit()` - Returns liquidation_bonus
- `getTotalCollateralValue()` - Returns collateral_seized
- `getDebtCovered()` - Returns debt_repaid
- `getLiquidationRatio()` - Returns collateral_seized / debt_repaid

**Static Methods:**
- `findByHash(txHash)` - Find liquidation by transaction hash
- `findByPosition(positionId)` - Get liquidations for a position
- `findByLiquidator(address, limit)` - Get liquidator's history
- `getRecentLiquidations(limit)` - Get recent liquidations
- `getLiquidationStats(startDate, endDate)` - Get statistics
- `getLiquidatorLeaderboard(startDate, endDate, limit)` - Get top liquidators

## Maintenance

### Backup Database

```bash
pg_dump -U engipay_user engipay_db > backup.sql
```

### Restore Database

```bash
psql -U engipay_user engipay_db < backup.sql
```

### Check Index Usage

```sql
SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE tablename LIKE 'vesu_%'
ORDER BY idx_scan DESC;
```

### Rebuild Indexes (if needed)

```sql
REINDEX TABLE vesu_positions;
REINDEX TABLE vesu_transactions;
REINDEX TABLE vesu_pools;
REINDEX TABLE vesu_liquidations;
```

### Update Statistics

```sql
ANALYZE vesu_positions;
ANALYZE vesu_transactions;
ANALYZE vesu_pools;
ANALYZE vesu_liquidations;
```

## Troubleshooting

### Migration Fails

If migrations fail, check:
1. Database connection settings in `.env`
2. PostgreSQL is running: `pg_isready`
3. User has proper permissions
4. Tables don't already exist (drop them first if needed)

### Indexes Not Created

Run the verify script to check:
```bash
npm run verify-indexes
```

If indexes are missing, you can create them manually or re-run migrations.

### Performance Issues

If queries are slow:
1. Check if indexes are being used: `EXPLAIN ANALYZE <query>`
2. Update table statistics: `ANALYZE vesu_positions`
3. Check for missing indexes in slow query logs
4. Consider adding partial indexes for specific use cases

## Next Steps

After setting up the database:
1. Implement the Starknet integration layer (Task 4)
2. Create the VesuService for business logic (Tasks 6-9)
3. Set up the position monitoring service (Task 11)
4. Implement API endpoints (Tasks 13-19)

## Additional Resources

- [Sequelize Documentation](https://sequelize.org/docs/v6/)
- [PostgreSQL Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [Vesu Database Indexes Documentation](./vesu-database-indexes.md)
