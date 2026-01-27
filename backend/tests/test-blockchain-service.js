/**
 * Test script for Blockchain Service - Backend Dev 1
 * Run with: node backend/tests/test-blockchain-service.js
 */

require('dotenv').config();
const blockchainService = require('../services/blockchainService');

async function testBlockchainService() {
  console.log('🧪 Testing Blockchain Service...\n');

  // Test wallet addresses (public addresses for testing)
  const testAddresses = {
    ethereum: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    starknet: '0x0742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
    bitcoin: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' // Genesis address
  };

  try {
    // Test 1: Get Ethereum balances
    console.log('📊 Test 1: Fetching Ethereum balances...');
    const ethBalances = await blockchainService.getPortfolioBalances(
      testAddresses.ethereum,
      'ethereum'
    );
    console.log('✅ Ethereum balances:', JSON.stringify(ethBalances, null, 2));
    console.log('');

    // Test 2: Get Bitcoin balance
    console.log('📊 Test 2: Fetching Bitcoin balance...');
    const btcBalance = await blockchainService.getPortfolioBalances(
      testAddresses.bitcoin,
      'bitcoin'
    );
    console.log('✅ Bitcoin balance:', JSON.stringify(btcBalance, null, 2));
    console.log('');

    // Test 3: Get asset prices
    console.log('📊 Test 3: Fetching asset prices...');
    const ethPrice = await blockchainService.getAssetPrice('ethereum');
    const btcPrice = await blockchainService.getAssetPrice('bitcoin');
    const strkPrice = await blockchainService.getAssetPrice('starknet');
    console.log('✅ Prices:');
    console.log(`   ETH: $${ethPrice}`);
    console.log(`   BTC: $${btcPrice}`);
    console.log(`   STRK: $${strkPrice}`);
    console.log('');

    // Test 4: Get all balances
    console.log('📊 Test 4: Fetching all chain balances...');
    const allBalances = await blockchainService.getPortfolioBalances(
      testAddresses.ethereum,
      'all'
    );
    console.log('✅ All balances:', JSON.stringify(allBalances, null, 2));
    console.log('');

    // Test 5: Estimate gas
    console.log('📊 Test 5: Estimating gas for Ethereum transaction...');
    const gasEstimate = await blockchainService.estimateGas({
      from: testAddresses.ethereum,
      to: '0x0000000000000000000000000000000000000000',
      value: '0.01',
      network: 'ethereum'
    });
    console.log('✅ Gas estimate:', JSON.stringify(gasEstimate, null, 2));
    console.log('');

    console.log('🎉 All tests passed!');
    console.log('\n✅ Backend Dev 1 blockchain integration is working!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
testBlockchainService()
  .then(() => {
    console.log('\n✅ Test suite completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  });
