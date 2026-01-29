/**
 * Test script for Vesu configuration
 * 
 * Usage: node scripts/test-vesu-config.js
 */

const vesuConfig = require('../config/vesu.config');

console.log('=== Vesu Configuration Test ===\n');

try {
  // Get current configuration
  const config = vesuConfig.getVesuConfig();
  console.log(`Network: ${config.network}`);
  console.log(`Oracle Address: ${config.oracle.address}`);
  console.log(`Monitoring Interval: ${config.monitoring.interval}ms\n`);
  
  // List active pools
  console.log('Active Pools:');
  const activePools = vesuConfig.getActivePools();
  
  if (activePools.length === 0) {
    console.log('  No active pools configured');
  } else {
    activePools.forEach(pool => {
      console.log(`  - ${pool.key}:`);
      console.log(`    Pool Address: ${pool.poolAddress}`);
      console.log(`    Max LTV: ${pool.maxLTV * 100}%`);
      console.log(`    Liquidation Threshold: ${pool.liquidationThreshold * 100}%`);
      console.log(`    Liquidation Bonus: ${pool.liquidationBonus * 100}%`);
    });
  }
  
  console.log('\nSupported Assets:');
  Object.values(config.assets).forEach(asset => {
    console.log(`  - ${asset.symbol} (${asset.name}): ${asset.decimals} decimals`);
  });
  
  console.log('\n✓ Configuration loaded successfully');
  
} catch (error) {
  console.error('✗ Configuration test failed:', error.message);
  process.exit(1);
}
