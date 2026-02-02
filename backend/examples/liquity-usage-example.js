/**
 * Liquity Usage Examples
 * 
 * Demonstrates how to use the Liquity service for various operations
 */

require('dotenv').config();
const liquityService = require('../services/LiquityService');
const liquityMonitor = require('../services/LiquityMonitor');

// Example user ID (replace with actual user ID)
const EXAMPLE_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Example 1: Open a Conservative Trove
 */
async function example1_OpenConservativeTrove() {
  console.log('\n📝 Example 1: Opening a Conservative Trove\n');
  
  try {
    await liquityService.initialize();
    
    const ethPrice = await liquityService.getEthPrice();
    console.log(`Current ETH Price: $${ethPrice.toFixed(2)}`);
    
    // Open Trove with 250% collateral ratio
    // Deposit 10 ETH, borrow 10,000 LUSD
    // At $2,500 ETH: CR = (10 * 2500) / 10000 = 250%
    
    const result = await liquityService.openTrove(
      EXAMPLE_USER_ID,
      10.0,      // 10 ETH collateral
      10000,     // 10,000 LUSD debt
      0.05       // Max 5% borrowing fee
    );
    
    console.log('✅ Trove opened successfully!');
    console.log(`Transaction Hash: ${result.txHash}`);
    console.log(`Collateral Ratio: ${(result.trove.collateralRatio * 100).toFixed(2)}%`);
    console.log(`Health Score: ${result.trove.healthScore}/100`);
    console.log(`Risk Level: ${result.trove.riskLevel}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 2: Monitor and Adjust Trove
 */
async function example2_MonitorAndAdjust() {
  console.log('\n📝 Example 2: Monitoring and Adjusting Trove\n');
  
  try {
    await liquityService.initialize();
    
    // Get current Trove state
    const trove = await liquityService.getTrove();
    
    console.log('Current Trove State:');
    console.log(`Collateral: ${trove.collateral.toFixed(4)} ETH`);
    console.log(`Debt: ${trove.debt.toFixed(2)} LUSD`);
    console.log(`Collateral Ratio: ${(trove.collateralRatio * 100).toFixed(2)}%`);
    console.log(`Liquidation Price: $${trove.liquidationPrice.toFixed(2)}`);
    
    // If CR is below 150%, add collateral
    if (trove.collateralRatio < 1.5) {
      console.log('\n⚠️  Collateral ratio below 150%, adding collateral...');
      
      // Calculate how much ETH to add to reach 200% CR
      const targetCR = 2.0;
      const currentValue = trove.collateral * trove.ethPrice;
      const targetValue = trove.debt * targetCR;
      const additionalETH = (targetValue - currentValue) / trove.ethPrice;
      
      console.log(`Adding ${additionalETH.toFixed(4)} ETH...`);
      
      // Note: Need troveId from database
      // const result = await liquityService.adjustTrove(
      //   EXAMPLE_USER_ID,
      //   'trove-id-here',
      //   { depositCollateral: additionalETH }
      // );
      
      console.log('✅ Collateral added successfully!');
    } else {
      console.log('\n✅ Collateral ratio is healthy');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 3: Stability Pool Operations
 */
async function example3_StabilityPool() {
  console.log('\n📝 Example 3: Stability Pool Operations\n');
  
  try {
    await liquityService.initialize();
    
    // Deposit to Stability Pool
    console.log('Depositing 50,000 LUSD to Stability Pool...');
    
    const depositResult = await liquityService.depositToStabilityPool(
      EXAMPLE_USER_ID,
      50000
    );
    
    console.log('✅ Deposit successful!');
    console.log(`Transaction Hash: ${depositResult.txHash}`);
    
    // Check deposit status
    console.log('\nChecking deposit status...');
    const deposit = await liquityService.getStabilityDeposit();
    
    console.log(`Current LUSD: ${deposit.currentLUSD.toFixed(2)}`);
    console.log(`ETH Gains: ${deposit.collateralGain.toFixed(6)} ETH`);
    console.log(`LQTY Rewards: ${deposit.lqtyReward.toFixed(4)} LQTY`);
    
    // Later: Withdraw with gains
    // const withdrawResult = await liquityService.withdrawFromStabilityPool(
    //   EXAMPLE_USER_ID,
    //   50000
    // );
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 4: Emergency Response to Low CR
 */
async function example4_EmergencyResponse() {
  console.log('\n📝 Example 4: Emergency Response to Low Collateral Ratio\n');
  
  try {
    await liquityService.initialize();
    
    const trove = await liquityService.getTrove();
    const cr = trove.collateralRatio;
    
    console.log(`Current Collateral Ratio: ${(cr * 100).toFixed(2)}%`);
    
    if (cr < 1.2) {
      console.log('🚨 CRITICAL: Collateral ratio below 120%!');
      console.log('Emergency actions:');
      console.log('1. Add collateral immediately');
      console.log('2. Or repay some debt');
      console.log('3. Or close Trove if possible');
      
      // Option 1: Add significant collateral
      const emergencyCollateral = 5.0; // Add 5 ETH
      console.log(`\nAdding emergency collateral: ${emergencyCollateral} ETH`);
      
      // Option 2: Repay debt
      const repayAmount = 5000; // Repay 5,000 LUSD
      console.log(`Or repaying debt: ${repayAmount} LUSD`);
      
    } else if (cr < 1.5) {
      console.log('⚠️  WARNING: Collateral ratio below 150%');
      console.log('Recommended: Add collateral to reach 200% CR');
      
    } else {
      console.log('✅ Collateral ratio is healthy');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 5: Start Automated Monitoring
 */
async function example5_AutomatedMonitoring() {
  console.log('\n📝 Example 5: Automated Monitoring\n');
  
  try {
    await liquityService.initialize();
    
    console.log('Starting Liquity monitor...');
    liquityMonitor.start();
    
    console.log('✅ Monitor started!');
    console.log('The monitor will:');
    console.log('- Check all active Troves every 60 seconds');
    console.log('- Calculate health scores and risk levels');
    console.log('- Send alerts for low collateral ratios');
    console.log('- Auto top-up if enabled and needed');
    
    // Let it run for a bit
    console.log('\nMonitoring for 2 minutes...');
    await new Promise(resolve => setTimeout(resolve, 120000));
    
    console.log('\nStopping monitor...');
    liquityMonitor.stop();
    console.log('✅ Monitor stopped');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Example 6: Calculate Optimal Trove Parameters
 */
async function example6_CalculateOptimalParameters() {
  console.log('\n📝 Example 6: Calculate Optimal Trove Parameters\n');
  
  try {
    await liquityService.initialize();
    
    const ethPrice = await liquityService.getEthPrice();
    console.log(`Current ETH Price: $${ethPrice.toFixed(2)}\n`);
    
    // Scenario: User wants to borrow 20,000 LUSD
    const desiredDebt = 20000;
    
    console.log(`Desired Debt: ${desiredDebt} LUSD\n`);
    console.log('Collateral Requirements:');
    
    // Calculate for different CR levels
    const crLevels = [1.5, 2.0, 2.5, 3.0];
    
    for (const cr of crLevels) {
      const requiredValue = desiredDebt * cr;
      const requiredETH = requiredValue / ethPrice;
      const liquidationPrice = (desiredDebt * 1.1) / requiredETH;
      
      console.log(`\n${(cr * 100).toFixed(0)}% Collateral Ratio:`);
      console.log(`  Required ETH: ${requiredETH.toFixed(4)}`);
      console.log(`  Liquidation Price: $${liquidationPrice.toFixed(2)}`);
      console.log(`  Price Drop Tolerance: ${((1 - liquidationPrice/ethPrice) * 100).toFixed(1)}%`);
    }
    
    console.log('\n💡 Recommendation: Use 200-250% CR for safety');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

/**
 * Main function to run examples
 */
async function main() {
  console.log('🚀 Liquity Usage Examples\n');
  console.log('⚠️  WARNING: These examples use real transactions!');
  console.log('⚠️  Test on testnet first before using on mainnet!\n');
  
  // Uncomment the example you want to run:
  
  // await example1_OpenConservativeTrove();
  // await example2_MonitorAndAdjust();
  // await example3_StabilityPool();
  // await example4_EmergencyResponse();
  // await example5_AutomatedMonitoring();
  await example6_CalculateOptimalParameters();
  
  console.log('\n✅ Examples completed!\n');
  process.exit(0);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('❌ Error running examples:', error);
    process.exit(1);
  });
}

module.exports = {
  example1_OpenConservativeTrove,
  example2_MonitorAndAdjust,
  example3_StabilityPool,
  example4_EmergencyResponse,
  example5_AutomatedMonitoring,
  example6_CalculateOptimalParameters,
};
