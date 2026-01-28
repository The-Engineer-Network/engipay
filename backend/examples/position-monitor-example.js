/**
 * Example: Using PositionMonitor Service
 * 
 * This example demonstrates how to use the PositionMonitor service
 * to monitor Vesu lending positions for health issues.
 */

const PositionMonitor = require('../services/PositionMonitor');
const { VesuService } = require('../services/VesuService');

/**
 * Example 1: Basic Usage
 * Start the position monitor with default configuration
 */
async function basicUsage() {
  console.log('=== Example 1: Basic Usage ===\n');

  // Create PositionMonitor instance
  const monitor = new PositionMonitor();

  // Start monitoring
  console.log('Starting position monitor...');
  monitor.start();

  // Check if running
  console.log(`Monitor is running: ${monitor.isRunning}`);

  // Get statistics
  const stats = monitor.getStats();
  console.log('Monitoring configuration:', {
    interval: `${stats.monitoringInterval}ms`,
    thresholds: stats.thresholds
  });

  // Let it run for a few seconds
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Stop monitoring
  console.log('\nStopping position monitor...');
  monitor.stop();

  // Get final statistics
  const finalStats = monitor.getStats();
  console.log('Final statistics:', finalStats.stats);
}

/**
 * Example 2: Custom Configuration
 * Create monitor with custom VesuService
 */
async function customConfiguration() {
  console.log('\n=== Example 2: Custom Configuration ===\n');

  // Create custom VesuService instance
  const vesuService = new VesuService();

  // Create PositionMonitor with custom service
  const monitor = new PositionMonitor(vesuService);

  console.log('Monitor created with custom VesuService');
  console.log('Configuration:', monitor.getStats().thresholds);
}

/**
 * Example 3: Manual Position Check
 * Check a specific position's health manually
 */
async function manualPositionCheck() {
  console.log('\n=== Example 3: Manual Position Check ===\n');

  const monitor = new PositionMonitor();

  // Example position (in real usage, this would come from database)
  const mockPosition = {
    id: 'example-position-1',
    user_id: 'example-user-1',
    pool_address: '0x123...',
    collateral_asset: 'ETH',
    debt_asset: 'USDC',
    collateral_amount: '1.5',
    debt_amount: '1000',
    hasDebt: () => true
  };

  console.log('Checking position health...');
  console.log('Position:', {
    id: mockPosition.id,
    collateral: `${mockPosition.collateral_amount} ${mockPosition.collateral_asset}`,
    debt: `${mockPosition.debt_amount} ${mockPosition.debt_asset}`
  });

  // Note: This would require actual database and oracle connections
  // For demonstration purposes only
  console.log('\nIn production, this would:');
  console.log('1. Fetch latest prices from Pragma Oracle');
  console.log('2. Calculate current health factor');
  console.log('3. Send alerts if health factor is below thresholds');
  console.log('4. Log health changes to database');
}

/**
 * Example 4: Monitoring Statistics
 * Track monitoring performance and alerts
 */
async function monitoringStatistics() {
  console.log('\n=== Example 4: Monitoring Statistics ===\n');

  const monitor = new PositionMonitor();

  // Get initial stats
  console.log('Initial statistics:', monitor.getStats().stats);

  // Start monitoring
  monitor.start();

  // Simulate some monitoring cycles
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Get updated stats
  const stats = monitor.getStats();
  console.log('\nUpdated statistics:', stats.stats);
  console.log('Last run time:', stats.lastRunTime);

  // Reset statistics
  monitor.resetStats();
  console.log('\nStatistics after reset:', monitor.getStats().stats);

  // Stop monitoring
  monitor.stop();
}

/**
 * Example 5: Alert Thresholds
 * Understanding the different alert levels
 */
function alertThresholds() {
  console.log('\n=== Example 5: Alert Thresholds ===\n');

  const monitor = new PositionMonitor();
  const thresholds = monitor.getStats().thresholds;

  console.log('Alert Thresholds:');
  console.log(`- Warning: Health Factor < ${thresholds.warning}`);
  console.log(`  → User receives warning notification`);
  console.log(`  → Priority: Medium`);
  console.log(`  → Channels: In-app, Email, Push\n`);

  console.log(`- Critical: Health Factor < ${thresholds.critical}`);
  console.log(`  → User receives critical alert`);
  console.log(`  → Priority: Critical`);
  console.log(`  → Channels: In-app, Email, Push, SMS\n`);

  console.log(`- Liquidation: Health Factor < ${thresholds.liquidation}`);
  console.log(`  → Position is liquidatable`);
  console.log(`  → User receives liquidation alert`);
  console.log(`  → Priority: Critical`);
  console.log(`  → Channels: In-app, Email, Push, SMS`);
}

/**
 * Example 6: Integration with Backend Server
 * How to integrate PositionMonitor into your Express server
 */
function serverIntegration() {
  console.log('\n=== Example 6: Server Integration ===\n');

  console.log('To integrate PositionMonitor into your Express server:\n');

  console.log('1. In server.js, import PositionMonitor:');
  console.log('   const PositionMonitor = require(\'./services/PositionMonitor\');\n');

  console.log('2. Create and start the monitor after server starts:');
  console.log('   const monitor = new PositionMonitor();');
  console.log('   monitor.start();\n');

  console.log('3. Stop the monitor on server shutdown:');
  console.log('   process.on(\'SIGTERM\', () => {');
  console.log('     monitor.stop();');
  console.log('     server.close();');
  console.log('   });\n');

  console.log('4. Optional: Add health check endpoint:');
  console.log('   app.get(\'/api/monitor/health\', (req, res) => {');
  console.log('     res.json(monitor.getStats());');
  console.log('   });');
}

/**
 * Run all examples
 */
async function runExamples() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║     PositionMonitor Service - Usage Examples          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  try {
    // Run examples sequentially
    await basicUsage();
    await customConfiguration();
    await manualPositionCheck();
    await monitoringStatistics();
    alertThresholds();
    serverIntegration();

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║     All examples completed successfully!              ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = {
  basicUsage,
  customConfiguration,
  manualPositionCheck,
  monitoringStatistics,
  alertThresholds,
  serverIntegration
};
