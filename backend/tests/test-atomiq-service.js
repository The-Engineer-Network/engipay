/**
 * Atomiq Service Test Suite - Backend Dev 3
 * Tests for cross-chain BTC <-> STRK swaps
 */

const atomiqService = require('../services/atomiqService');

// Test configuration
const TEST_CONFIG = {
  // Test StarkNet address (replace with actual test address)
  starknetAddress: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
  // Test Bitcoin address (replace with actual test address)
  bitcoinAddress: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
  // Test amounts (in smallest units)
  btcAmount: '100000', // 0.001 BTC in satoshis
  strkAmount: '1000000000000000000' // 1 STRK in wei
};

/**
 * Test 1: Initialize Atomiq Service
 */
async function testInitialization() {
  console.log('\n=== Test 1: Initialize Atomiq Service ===');
  try {
    await atomiqService.initialize();
    console.log('✅ Atomiq service initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    return false;
  }
}

/**
 * Test 2: Get Swap Limits
 */
async function testGetSwapLimits() {
  console.log('\n=== Test 2: Get Swap Limits ===');
  try {
    const limits = await atomiqService.getSwapLimits();
    console.log('✅ Swap limits retrieved:');
    console.log('BTC -> STRK:');
    console.log(`  Input: ${limits.btc_to_strk.input.min} - ${limits.btc_to_strk.input.max} satoshis`);
    console.log(`  Output: ${limits.btc_to_strk.output.min} - ${limits.btc_to_strk.output.max} wei`);
    console.log('STRK -> BTC:');
    console.log(`  Input: ${limits.strk_to_btc.input.min} - ${limits.strk_to_btc.input.max} wei`);
    console.log(`  Output: ${limits.strk_to_btc.output.min} - ${limits.strk_to_btc.output.max} satoshis`);
    return true;
  } catch (error) {
    console.error('❌ Get swap limits failed:', error.message);
    return false;
  }
}

/**
 * Test 3: Get BTC -> STRK Quote
 */
async function testGetBtcToStrkQuote() {
  console.log('\n=== Test 3: Get BTC -> STRK Quote ===');
  try {
    const quote = await atomiqService.getSwapQuote(
      TEST_CONFIG.btcAmount,
      true, // exact input
      TEST_CONFIG.starknetAddress
    );
    console.log('✅ BTC -> STRK quote retrieved:');
    console.log(`  Swap ID: ${quote.swap_id}`);
    console.log(`  From: ${quote.from_amount} satoshis (${parseInt(quote.from_amount) / 100000000} BTC)`);
    console.log(`  To: ${quote.to_amount} wei (${parseInt(quote.to_amount) / 1e18} STRK)`);
    console.log(`  Fee: ${quote.fee} satoshis`);
    console.log(`  Bitcoin Address: ${quote.bitcoin_address}`);
    console.log(`  Expires: ${quote.expires_at}`);
    console.log(`  State: ${quote.state}`);
    return quote;
  } catch (error) {
    console.error('❌ Get BTC -> STRK quote failed:', error.message);
    return null;
  }
}

/**
 * Test 4: Get STRK -> BTC Quote
 */
async function testGetStrkToBtcQuote() {
  console.log('\n=== Test 4: Get STRK -> BTC Quote ===');
  try {
    const quote = await atomiqService.getSwapQuoteReverse(
      TEST_CONFIG.strkAmount,
      true, // exact input
      TEST_CONFIG.starknetAddress,
      TEST_CONFIG.bitcoinAddress
    );
    console.log('✅ STRK -> BTC quote retrieved:');
    console.log(`  Swap ID: ${quote.swap_id}`);
    console.log(`  From: ${quote.from_amount} wei (${parseInt(quote.from_amount) / 1e18} STRK)`);
    console.log(`  To: ${quote.to_amount} satoshis (${parseInt(quote.to_amount) / 100000000} BTC)`);
    console.log(`  Fee: ${quote.fee} wei`);
    console.log(`  Expires: ${quote.expires_at}`);
    console.log(`  State: ${quote.state}`);
    return quote;
  } catch (error) {
    console.error('❌ Get STRK -> BTC quote failed:', error.message);
    return null;
  }
}

/**
 * Test 5: Get Swap Status
 */
async function testGetSwapStatus(swapId) {
  console.log('\n=== Test 5: Get Swap Status ===');
  try {
    const status = await atomiqService.getSwapStatus(swapId);
    console.log('✅ Swap status retrieved:');
    console.log(`  Swap ID: ${status.swap_id}`);
    console.log(`  State: ${status.state}`);
    console.log(`  From: ${status.from_amount} ${status.from_token}`);
    console.log(`  To: ${status.to_amount} ${status.to_token}`);
    console.log(`  Fee: ${status.fee}`);
    return true;
  } catch (error) {
    console.error('❌ Get swap status failed:', error.message);
    return false;
  }
}

/**
 * Test 6: Get All Swaps
 */
async function testGetAllSwaps() {
  console.log('\n=== Test 6: Get All Swaps ===');
  try {
    const swaps = await atomiqService.getAllSwaps();
    console.log(`✅ Retrieved ${swaps.length} swaps`);
    if (swaps.length > 0) {
      console.log('Recent swaps:');
      swaps.slice(0, 3).forEach((swap, index) => {
        console.log(`  ${index + 1}. ${swap.from_token} -> ${swap.to_token} (${swap.state})`);
      });
    }
    return true;
  } catch (error) {
    console.error('❌ Get all swaps failed:', error.message);
    return false;
  }
}

/**
 * Test 7: Get Claimable Swaps
 */
async function testGetClaimableSwaps() {
  console.log('\n=== Test 7: Get Claimable Swaps ===');
  try {
    const swaps = await atomiqService.getClaimableSwaps();
    console.log(`✅ Retrieved ${swaps.length} claimable swaps`);
    if (swaps.length > 0) {
      console.log('Claimable swaps:');
      swaps.forEach((swap, index) => {
        console.log(`  ${index + 1}. ${swap.from_token} -> ${swap.to_token} (${swap.to_amount})`);
      });
    }
    return true;
  } catch (error) {
    console.error('❌ Get claimable swaps failed:', error.message);
    return false;
  }
}

/**
 * Test 8: Get Refundable Swaps
 */
async function testGetRefundableSwaps() {
  console.log('\n=== Test 8: Get Refundable Swaps ===');
  try {
    const swaps = await atomiqService.getRefundableSwaps();
    console.log(`✅ Retrieved ${swaps.length} refundable swaps`);
    if (swaps.length > 0) {
      console.log('Refundable swaps:');
      swaps.forEach((swap, index) => {
        console.log(`  ${index + 1}. ${swap.from_token} -> ${swap.to_token} (${swap.from_amount})`);
      });
    }
    return true;
  } catch (error) {
    console.error('❌ Get refundable swaps failed:', error.message);
    return false;
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Atomiq Service Test Suite - Backend Dev 3             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  const results = {
    passed: 0,
    failed: 0,
    total: 0
  };

  // Test 1: Initialization
  results.total++;
  if (await testInitialization()) {
    results.passed++;
  } else {
    results.failed++;
    console.log('\n❌ Cannot continue without initialization');
    return results;
  }

  // Test 2: Get Swap Limits
  results.total++;
  if (await testGetSwapLimits()) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Test 3: Get BTC -> STRK Quote
  results.total++;
  const btcQuote = await testGetBtcToStrkQuote();
  if (btcQuote) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Test 4: Get STRK -> BTC Quote
  results.total++;
  const strkQuote = await testGetStrkToBtcQuote();
  if (strkQuote) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Test 5: Get Swap Status (if we have a quote)
  if (btcQuote) {
    results.total++;
    if (await testGetSwapStatus(btcQuote.swap_id)) {
      results.passed++;
    } else {
      results.failed++;
    }
  }

  // Test 6: Get All Swaps
  results.total++;
  if (await testGetAllSwaps()) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Test 7: Get Claimable Swaps
  results.total++;
  if (await testGetClaimableSwaps()) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Test 8: Get Refundable Swaps
  results.total++;
  if (await testGetRefundableSwaps()) {
    results.passed++;
  } else {
    results.failed++;
  }

  // Print summary
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                      Test Summary                          ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`Total Tests: ${results.total}`);
  console.log(`Passed: ${results.passed} ✅`);
  console.log(`Failed: ${results.failed} ❌`);
  console.log(`Success Rate: ${((results.passed / results.total) * 100).toFixed(1)}%`);

  return results;
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests()
    .then((results) => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runAllTests,
  testInitialization,
  testGetSwapLimits,
  testGetBtcToStrkQuote,
  testGetStrkToBtcQuote,
  testGetSwapStatus,
  testGetAllSwaps,
  testGetClaimableSwaps,
  testGetRefundableSwaps
};
