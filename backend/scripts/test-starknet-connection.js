/**
 * Test script for Starknet RPC connection
 * 
 * Usage: node scripts/test-starknet-connection.js
 */

const { getStarknetProvider, validateConnection, getChainId } = require('../config/starknet');

async function testConnection() {
  console.log('=== Starknet Connection Test ===\n');
  
  try {
    // Initialize provider
    console.log('Initializing Starknet provider...');
    const provider = getStarknetProvider();
    
    // Get chain ID
    const chainId = getChainId();
    console.log(`Chain ID: ${chainId}\n`);
    
    // Validate connection
    console.log('Testing connection...');
    const isConnected = await validateConnection(provider);
    
    if (isConnected) {
      // Get additional network info
      const blockNumber = await provider.getBlockNumber();
      const block = await provider.getBlock(blockNumber);
      
      console.log('\nNetwork Information:');
      console.log(`  Block Number: ${blockNumber}`);
      console.log(`  Block Hash: ${block.block_hash}`);
      console.log(`  Timestamp: ${new Date(block.timestamp * 1000).toISOString()}`);
      
      console.log('\n✓ Connection test successful');
      process.exit(0);
    } else {
      console.error('\n✗ Connection test failed');
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n✗ Connection test failed:', error.message);
    console.error('\nTroubleshooting:');
    console.error('  1. Check STARKNET_RPC_URL is set in .env');
    console.error('  2. Verify RPC endpoint is accessible');
    console.error('  3. Ensure network selection matches RPC endpoint');
    process.exit(1);
  }
}

testConnection();
