/**
 * Test script for PragmaOracleService
 * 
 * This script demonstrates the PragmaOracleService functionality
 * and can be used to verify the oracle integration is working.
 * 
 * Usage: node scripts/test-pragma-oracle.js
 */

const { PragmaOracleService, AggregationMode, ASSET_IDENTIFIERS } = require('../services/PragmaOracleService');

async function testPragmaOracle() {
  console.log('=== Pragma Oracle Service Test ===\n');

  try {
    // Initialize service
    console.log('1. Initializing PragmaOracleService...');
    const oracleService = new PragmaOracleService();
    console.log(`   Oracle Address: ${oracleService.oracleAddress}`);
    console.log(`   Cache TTL: ${oracleService.cacheTTL}ms`);
    console.log(`   Staleness Tolerance: ${oracleService.priceStalenessTolerance}s\n`);

    // Test asset identifiers
    console.log('2. Available Asset Identifiers:');
    Object.entries(ASSET_IDENTIFIERS).forEach(([asset, id]) => {
      console.log(`   ${asset}: ${id}`);
    });
    console.log();

    // Test aggregation modes
    console.log('3. Aggregation Modes:');
    console.log(`   MEDIAN: ${AggregationMode.MEDIAN}`);
    console.log(`   MEAN: ${AggregationMode.MEAN}`);
    console.log(`   ERROR: ${AggregationMode.ERROR}\n`);

    // Test health check
    console.log('4. Running health check...');
    const healthResult = await oracleService.healthCheck();
    if (healthResult.healthy) {
      console.log('   ✓ Oracle is healthy');
      console.log(`   Test Asset: ${healthResult.testAsset}`);
      console.log(`   Price: $${healthResult.price}`);
      console.log(`   Last Updated: ${new Date(healthResult.lastUpdated * 1000).toISOString()}`);
      console.log(`   Number of Sources: ${healthResult.numSources}\n`);
    } else {
      console.log('   ✗ Oracle health check failed');
      console.log(`   Error: ${healthResult.error}\n`);
      return;
    }

    // Test single price fetch
    console.log('5. Fetching single asset price (ETH)...');
    const ethPrice = await oracleService.getPrice('ETH');
    console.log(`   Asset: ${ethPrice.asset}`);
    console.log(`   Price: $${ethPrice.price}`);
    console.log(`   Decimals: ${ethPrice.decimals}`);
    console.log(`   Last Updated: ${new Date(ethPrice.lastUpdatedTimestamp * 1000).toISOString()}`);
    console.log(`   Sources: ${ethPrice.numSourcesAggregated}`);
    console.log(`   Cached: ${ethPrice.cached}\n`);

    // Test batch price fetch
    console.log('6. Fetching multiple asset prices (ETH, BTC, STRK)...');
    const prices = await oracleService.getPrices(['ETH', 'BTC', 'STRK']);
    Object.entries(prices).forEach(([asset, data]) => {
      if (data.error) {
        console.log(`   ${asset}: Error - ${data.error}`);
      } else {
        console.log(`   ${asset}: $${data.price} (${data.numSourcesAggregated} sources, cached: ${data.cached})`);
      }
    });
    console.log();

    // Test cache
    console.log('7. Testing cache (fetching ETH again)...');
    const ethPriceCached = await oracleService.getPrice('ETH');
    console.log(`   Cached: ${ethPriceCached.cached}`);
    console.log(`   Price: $${ethPriceCached.price}\n`);

    // Test fallback mechanism
    console.log('8. Testing fallback mechanism...');
    try {
      const fallbackPrice = await oracleService.getPriceWithFallback('ETH');
      console.log(`   ✓ Fallback successful`);
      console.log(`   Price: $${fallbackPrice.price}`);
      console.log(`   Fallback used: ${fallbackPrice.fallback || false}\n`);
    } catch (error) {
      console.log(`   ✗ Fallback failed: ${error.message}\n`);
    }

    // Test price staleness validation
    console.log('9. Testing price staleness validation...');
    const currentTime = Math.floor(Date.now() / 1000);
    const staleTimestamp = currentTime - 400; // 400 seconds ago
    const freshTimestamp = currentTime - 100; // 100 seconds ago
    console.log(`   Stale price (400s old): ${oracleService.isPriceStale(staleTimestamp)}`);
    console.log(`   Fresh price (100s old): ${oracleService.isPriceStale(freshTimestamp)}\n`);

    console.log('=== All Tests Completed Successfully ===');

  } catch (error) {
    console.error('\n✗ Test failed with error:');
    console.error(`   ${error.message}`);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testPragmaOracle()
  .then(() => {
    console.log('\nExiting...');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nUnexpected error:', error);
    process.exit(1);
  });
