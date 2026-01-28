# PositionMonitor Service

## Overview

The `PositionMonitor` service is a background monitoring system for Vesu V2 lending positions. It continuously monitors all active positions for health issues and sends alerts to users when their positions are at risk of liquidation.

## Features

- **Automated Monitoring**: Runs on a configurable schedule using cron jobs
- **Multi-Level Alerts**: Warning, Critical, and Liquidation alerts based on health factor thresholds
- **Real-Time Health Tracking**: Updates position health factors using latest oracle prices
- **Comprehensive Notifications**: Sends alerts via multiple channels (in-app, email, push, SMS)
- **Performance Tracking**: Built-in statistics for monitoring service performance

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PositionMonitor                          │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  Cron Job    │───▶│  Monitor All │───▶│ Check Health │ │
│  │  Scheduler   │    │  Positions   │    │  Per Position│ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐ │
│  │  VesuService │    │   Pragma     │    │ Notification │ │
│  │  Integration │    │   Oracle     │    │   Service    │ │
│  └──────────────┘    └──────────────┘    └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

The monitoring service is configured via `backend/config/vesu.config.js`:

```javascript
monitoring: {
  interval: 60000,           // Monitoring interval in milliseconds (1 minute)
  warningThreshold: 1.2,     // Health factor warning level
  criticalThreshold: 1.05,   // Health factor critical level
  liquidationThreshold: 1.0  // Health factor liquidation level
}
```

### Alert Thresholds

| Level | Health Factor | Priority | Channels | Description |
|-------|--------------|----------|----------|-------------|
| **Warning** | < 1.2 | Medium | In-app, Email, Push | Position is at risk |
| **Critical** | < 1.05 | Critical | In-app, Email, Push, SMS | Position near liquidation |
| **Liquidation** | < 1.0 | Critical | In-app, Email, Push, SMS | Position is liquidatable |

## Usage

### Basic Setup

```javascript
const PositionMonitor = require('./services/PositionMonitor');

// Create monitor instance
const monitor = new PositionMonitor();

// Start monitoring
monitor.start();

// Stop monitoring
monitor.stop();
```

### Integration with Express Server

```javascript
// server.js
const express = require('express');
const PositionMonitor = require('./services/PositionMonitor');

const app = express();
const monitor = new PositionMonitor();

// Start server
const server = app.listen(3000, () => {
  console.log('Server started on port 3000');
  
  // Start position monitoring
  monitor.start();
  console.log('Position monitoring started');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  // Stop monitoring
  monitor.stop();
  
  // Close server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Optional: Health check endpoint
app.get('/api/monitor/health', (req, res) => {
  const stats = monitor.getStats();
  res.json({
    status: stats.isRunning ? 'running' : 'stopped',
    lastRun: stats.lastRunTime,
    statistics: stats.stats,
    thresholds: stats.thresholds
  });
});
```

### Custom Configuration

```javascript
const PositionMonitor = require('./services/PositionMonitor');
const { VesuService } = require('./services/VesuService');
const Notification = require('./models/Notification');

// Create custom VesuService instance
const vesuService = new VesuService();

// Create monitor with custom dependencies
const monitor = new PositionMonitor(vesuService, Notification);

monitor.start();
```

## API Reference

### Constructor

```javascript
new PositionMonitor(vesuService, notificationService)
```

**Parameters:**
- `vesuService` (VesuService, optional): VesuService instance for position operations
- `notificationService` (Notification, optional): Notification model for creating alerts

### Methods

#### `start()`

Starts the position monitoring service with cron job scheduling.

```javascript
monitor.start();
```

#### `stop()`

Stops the position monitoring service and cleans up cron jobs.

```javascript
monitor.stop();
```

#### `monitorAllPositions()`

Manually trigger a monitoring cycle for all active positions.

```javascript
const result = await monitor.monitorAllPositions();
console.log(result);
// {
//   success: true,
//   positionsChecked: 10,
//   warnings: 2,
//   criticalAlerts: 1,
//   liquidationAlerts: 0,
//   duration: 1234
// }
```

#### `checkPositionHealth(position)`

Check health of a specific position.

```javascript
const result = await monitor.checkPositionHealth(position);
console.log(result);
// {
//   positionId: 'uuid',
//   healthStatus: 'at-risk',
//   healthFactor: 1.15,
//   alertIssued: true,
//   alertType: 'warning'
// }
```

#### `getStats()`

Get monitoring statistics and configuration.

```javascript
const stats = monitor.getStats();
console.log(stats);
// {
//   isRunning: true,
//   lastRunTime: Date,
//   monitoringInterval: 60000,
//   thresholds: {
//     warning: 1.2,
//     critical: 1.05,
//     liquidation: 1.0
//   },
//   stats: {
//     totalRuns: 100,
//     positionsChecked: 1000,
//     warningsIssued: 50,
//     criticalAlertsIssued: 10,
//     liquidationAlertsIssued: 2,
//     errors: 0
//   }
// }
```

#### `resetStats()`

Reset monitoring statistics.

```javascript
monitor.resetStats();
```

## Monitoring Workflow

### 1. Position Discovery

The monitor queries all active positions from the database:

```sql
SELECT * FROM vesu_positions 
WHERE status = 'active' 
ORDER BY health_factor ASC NULLS LAST
```

### 2. Health Check Process

For each position:

1. **Skip positions with no debt** (cannot be liquidated)
2. **Update health factor** using latest oracle prices
3. **Evaluate health status** against thresholds
4. **Send appropriate alerts** based on health factor

### 3. Alert Generation

Based on health factor:

- **HF < 1.0**: Liquidation alert (position is liquidatable)
- **HF < 1.05**: Critical alert (near liquidation)
- **HF < 1.2**: Warning alert (at risk)
- **HF >= 1.2**: No alert (healthy)

### 4. Notification Creation

Alerts are stored in the Notification model with:

- User ID for targeting
- Position ID for reference
- Alert type and priority
- Multi-channel delivery configuration
- Metadata for tracking

## Notification Schema

```javascript
{
  notification_id: 'uuid',
  user_id: 'uuid',
  type: 'health_factor_warning' | 'position_liquidation',
  priority: 'medium' | 'critical',
  status: 'unread',
  title: 'Alert Title',
  message: 'Alert Message',
  description: 'Detailed Description',
  category: 'defi',
  source: 'system',
  related_entities: {
    position_id: 'uuid'
  },
  channels: {
    in_app: true,
    email: true,
    push: true,
    sms: false
  },
  metadata: {
    position_id: 'uuid',
    pool_address: '0x...',
    collateral_asset: 'ETH',
    debt_asset: 'USDC',
    health_factor: 1.15,
    threshold: 1.2,
    alert_level: 'warning'
  }
}
```

## Performance Considerations

### Monitoring Interval

- **Testnet**: 60 seconds (1 minute)
- **Mainnet**: 30 seconds (recommended)

Adjust based on:
- Number of active positions
- Oracle price update frequency
- RPC provider rate limits
- Database performance

### Optimization Tips

1. **Database Indexing**: Ensure indexes on `status` and `health_factor` columns
2. **Batch Processing**: Monitor processes positions sequentially but could be parallelized
3. **Caching**: Oracle prices are cached by PragmaOracleService
4. **Error Handling**: Failed position checks don't stop the monitoring cycle

## Error Handling

The monitor includes comprehensive error handling:

```javascript
try {
  const result = await monitor.checkPositionHealth(position);
} catch (error) {
  console.error(`Error checking position ${position.id}:`, error);
  // Error is logged but monitoring continues for other positions
}
```

Errors are tracked in statistics:

```javascript
const stats = monitor.getStats();
console.log(`Total errors: ${stats.stats.errors}`);
```

## Testing

Run the test suite:

```bash
npm test -- position-monitor.test.js
```

Test coverage includes:
- Initialization and configuration
- Start/stop functionality
- Position health checking
- Alert generation for all levels
- Statistics tracking

## Logging

The monitor provides detailed logging:

```
PositionMonitor initialized { monitoringInterval: 60000, ... }
Starting PositionMonitor { cronExpression: '*/1 * * * *', ... }
PositionMonitor started successfully
Starting position monitoring cycle
Found 10 active positions to monitor
AT-RISK position detected: position-id, HF: 1.15
Sending warning alert { positionId: '...', userId: '...', ... }
Warning alert created { notificationId: '...', positionId: '...' }
Position monitoring cycle completed { positionsChecked: 10, ... }
```

## Dependencies

- **node-cron**: Cron job scheduling
- **VesuService**: Position health calculations
- **PragmaOracleService**: Real-time price feeds
- **Notification Model**: Alert storage and delivery
- **VesuPosition Model**: Position data access

## Environment Variables

Required environment variables (inherited from VesuService):

```env
STARKNET_NETWORK=sepolia
STARKNET_RPC_URL=https://...
VESU_ORACLE_ADDRESS=0x...
```

## Troubleshooting

### Monitor not starting

**Issue**: `monitor.start()` doesn't start monitoring

**Solution**: Check that:
- Environment variables are set
- Database connection is established
- VesuService initializes correctly

### No alerts being sent

**Issue**: Positions are unhealthy but no alerts

**Solution**: Verify:
- Notification model is accessible
- MongoDB connection is active
- Position health factors are being updated

### High error rate

**Issue**: Many errors in monitoring statistics

**Solution**: Check:
- Oracle service availability
- RPC provider connectivity
- Database query performance
- Position data integrity

## Future Enhancements

Potential improvements for future versions:

1. **Parallel Processing**: Monitor multiple positions concurrently
2. **Alert Throttling**: Prevent duplicate alerts for same position
3. **Custom Thresholds**: Per-user or per-pool alert thresholds
4. **Webhook Integration**: Send alerts to external services
5. **Dashboard Integration**: Real-time monitoring dashboard
6. **Historical Tracking**: Track health factor changes over time

## Related Documentation

- [VesuService Documentation](./VesuService.js)
- [Notification Model](../models/Notification.js)
- [Vesu Configuration](../config/vesu.config.js)
- [Design Document](../../.kiro/specs/vesu-lending-integration/design.md)

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review test cases for usage examples
3. Consult the design document for architecture details
4. Check logs for error messages

## License

MIT
