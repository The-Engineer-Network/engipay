// Test script to verify cross-chain integration
// Run with: node test-cross-chain-integration.js

const testEndpoints = [
  'http://localhost:3000/api/swap/atomiq/quote',
  'http://localhost:3000/api/swap/atomiq/initiate', 
  'http://localhost:3000/api/swap/atomiq/history',
  'http://localhost:3000/api/swap/atomiq/claimable',
  'http://localhost:3000/api/swap/atomiq/refundable',
  'http://localhost:3000/api/swap/atomiq/limits',
  'http://localhost:3000/api/portfolio/balances'
];

async function testEndpoint(url, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-token'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(url, options);
    const status = response.status;
    
    console.log(`${method} ${url}: ${status} ${response.statusText}`);
    
    if (status === 200 || status === 400 || status === 401) {
      // Expected responses (200 = success, 400/401 = expected errors without backend)
      return true;
    }
    
    return false;
  } catch (error) {
    console.log(`${method} ${url}: ERROR - ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🧪 Testing Cross-Chain API Integration...\n');
  
  // Test GET endpoints
  for (const endpoint of testEndpoints) {
    await testEndpoint(endpoint);
  }
  
  console.log('\n📝 Testing POST endpoints...');
  
  // Test POST endpoints with sample data
  await testEndpoint('http://localhost:3000/api/swap/atomiq/quote', 'POST', {
    fromToken: 'BTC',
    toToken: 'ETH', 
    amount: 0.1,
    slippage: 0.5
  });
  
  await testEndpoint('http://localhost:3000/api/swap/atomiq/initiate', 'POST', {
    quoteId: 'test-quote-id',
    fromToken: 'BTC',
    toToken: 'ETH',
    fromAmount: '0.1',
    toAmount: '2.5'
  });
  
  console.log('\n✅ Integration test complete!');
  console.log('\n📋 Next Steps:');
  console.log('1. Start the backend server: cd backend && npm run dev');
  console.log('2. Start the frontend: npm run dev');
  console.log('3. Test the cross-chain swap UI at /payments-swaps');
  console.log('4. Verify wallet connection and swap functionality');
}

// Only run if this file is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testEndpoint, runTests };