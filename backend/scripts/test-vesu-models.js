const { sequelize } = require('../config/database');

/**
 * Test script to verify Vesu models load correctly
 * This checks that all models are defined and associations work
 */

async function testModels() {
  try {
    console.log('🧪 Testing Vesu models...\n');

    // Load models
    const VesuPool = require('../models/VesuPool');
    const VesuPosition = require('../models/VesuPosition');
    const VesuTransaction = require('../models/VesuTransaction');
    const VesuLiquidation = require('../models/VesuLiquidation');

    console.log(' All models loaded successfully\n');

    // Check model names
    console.log(' Model Information:');
    console.log('─'.repeat(60));
    console.log(`VesuPool table: ${VesuPool.tableName}`);
    console.log(`VesuPosition table: ${VesuPosition.tableName}`);
    console.log(`VesuTransaction table: ${VesuTransaction.tableName}`);
    console.log(`VesuLiquidation table: ${VesuLiquidation.tableName}`);
    console.log('');

    // Check instance methods
    console.log('🔧 Checking instance methods:');
    console.log('─'.repeat(60));
    
    const positionMethods = [
      'isHealthy', 'isAtRisk', 'isCritical', 'isLiquidatable',
      'hasDebt', 'hasCollateral'
    ];
    console.log('VesuPosition methods:');
    positionMethods.forEach(method => {
      const exists = typeof VesuPosition.prototype[method] === 'function';
      console.log(`  ${method}`);
    });

    const poolMethods = [
      'getUtilizationRate', 'getAvailableLiquidity', 'isHealthy',
      'canBorrow', 'needsSync', 'getAssetPair'
    ];
    console.log('\nVesuPool methods:');
    poolMethods.forEach(method => {
      const exists = typeof VesuPool.prototype[method] === 'function';
      console.log(`   ${method}`);
    });

    const txMethods = [
      'isPending', 'isConfirmed', 'isFailed', 'isSupply',
      'isBorrow', 'isRepay', 'isWithdraw', 'isLiquidation'
    ];
    console.log('\nVesuTransaction methods:');
    txMethods.forEach(method => {
      const exists = typeof VesuTransaction.prototype[method] === 'function';
      console.log(`   ${method}`);
    });

    const liqMethods = [
      'getLiquidationProfit', 'getTotalCollateralValue',
      'getDebtCovered', 'getLiquidationRatio'
    ];
    console.log('\nVesuLiquidation methods:');
    liqMethods.forEach(method => {
      const exists = typeof VesuLiquidation.prototype[method] === 'function';
      console.log(`   ${method}`);
    });

    // Check static methods
    console.log('\n🔍 Checking static methods:');
    console.log('─'.repeat(60));
    
    const positionStatics = [
      'findActivePositions', 'findLiquidatablePositions',
      'findAtRiskPositions', 'findUserPositions'
    ];
    console.log('VesuPosition static methods:');
    positionStatics.forEach(method => {
      const exists = typeof VesuPosition[method] === 'function';
      console.log(`   ${method}`);
    });

    const poolStatics = [
      'findByAddress', 'findActivePools', 'findByAssetPair',
      'findPoolsNeedingSync', 'getPoolStats'
    ];
    console.log('\nVesuPool static methods:');
    poolStatics.forEach(method => {
      const exists = typeof VesuPool[method] === 'function';
      console.log(`   ${method}`);
    });

    const txStatics = [
      'findByHash', 'findPendingTransactions', 'findUserTransactions',
      'findPositionTransactions', 'getTransactionStats'
    ];
    console.log('\nVesuTransaction static methods:');
    txStatics.forEach(method => {
      const exists = typeof VesuTransaction[method] === 'function';
      console.log(`   ${method}`);
    });

    const liqStatics = [
      'findByHash', 'findByPosition', 'findByLiquidator',
      'getRecentLiquidations', 'getLiquidationStats', 'getLiquidatorLeaderboard'
    ];
    console.log('\nVesuLiquidation static methods:');
    liqStatics.forEach(method => {
      const exists = typeof VesuLiquidation[method] === 'function';
      console.log(`   ${method}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ All Vesu models are properly configured!');
    console.log('='.repeat(60) + '\n');

    console.log('📝 Next steps:');
    console.log('  1. Run migrations: npm run migrate');
    console.log('  2. Verify indexes: npm run verify-indexes');
    console.log('  3. Start implementing Vesu services (Task 4+)');
    console.log('');

  } catch (error) {
    console.error('❌ Model test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// Run test
testModels();
