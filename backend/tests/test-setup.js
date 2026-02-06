/**
 * Test Setup for E2E Integration Tests
 * 
 * This module provides setup utilities for end-to-end testing on Sepolia testnet.
 * It handles:
 * - Environment configuration
 * - Test account management
 * - Database setup and teardown
 * - Service initialization
 */

const path = require('path');
const dotenv = require('dotenv');
const { Sequelize } = require('sequelize');

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '.env.test') });

/**
 * Test configuration
 */
const testConfig = {
  network: process.env.STARKNET_NETWORK || 'sepolia',
  rpcUrl: process.env.STARKNET_RPC_URL,
  timeout: parseInt(process.env.TEST_TIMEOUT) || 60000,
  retryAttempts: parseInt(process.env.TEST_RETRY_ATTEMPTS) || 3,
  retryDelay: parseInt(process.env.TEST_RETRY_DELAY) || 5000,
  
  // Test accounts
  accounts: {
    account1: {
      address: process.env.TEST_ACCOUNT_1_ADDRESS,
      privateKey: process.env.TEST_ACCOUNT_1_PRIVATE_KEY,
      userId: process.env.TEST_USER_1_ID || 'test-user-1-uuid'
    },
    account2: {
      address: process.env.TEST_ACCOUNT_2_ADDRESS,
      privateKey: process.env.TEST_ACCOUNT_2_PRIVATE_KEY,
      userId: process.env.TEST_USER_2_ID || 'test-user-2-uuid'
    }
  },
  
  // Vesu protocol addresses
  vesu: {
    oracleAddress: process.env.VESU_ORACLE_ADDRESS,
    pools: {
      'ETH-USDC': process.env.VESU_ETH_USDC_POOL,
      'STRK-USDC': process.env.VESU_STRK_USDC_POOL
    }
  },
  
  // Database configuration
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    name: process.env.DB_NAME || 'engipay_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'test_password'
  }
};

/**
 * Database connection for tests
 */
let sequelize = null;

/**
 * Initialize database connection
 */
async function initializeDatabase() {
  if (sequelize) {
    return sequelize;
  }

  sequelize = new Sequelize(
    testConfig.database.name,
    testConfig.database.user,
    testConfig.database.password,
    {
      host: testConfig.database.host,
      port: testConfig.database.port,
      dialect: 'postgres',
      logging: false, // Disable SQL logging in tests
      pool: {
        max: 5,
        min: 0,
        acquire: 30000,
        idle: 10000
      }
    }
  );

  try {
    await sequelize.authenticate();
    console.log('Test database connection established successfully');
    return sequelize;
  } catch (error) {
    console.error('Unable to connect to test database:', error);
    throw error;
  }
}

/**
 * Clean up database (remove test data)
 */
async function cleanupDatabase() {
  if (!sequelize) {
    return;
  }

  try {
    // Import models
    const VesuPosition = require('../models/VesuPosition');
    const VesuTransaction = require('../models/VesuTransaction');
    const VesuLiquidation = require('../models/VesuLiquidation');
    const Notification = require('../models/Notification');

    // Delete test data
    await VesuLiquidation.destroy({ where: {}, truncate: true });
    await VesuTransaction.destroy({ where: {}, truncate: true });
    await VesuPosition.destroy({ where: {}, truncate: true });
    await Notification.destroy({ 
      where: { 
        user_id: [
          testConfig.accounts.account1.userId,
          testConfig.accounts.account2.userId
        ]
      } 
    });

    console.log('Test database cleaned up successfully');
  } catch (error) {
    console.error('Error cleaning up test database:', error);
    throw error;
  }
}

/**
 * Close database connection
 */
async function closeDatabase() {
  if (sequelize) {
    await sequelize.close();
    sequelize = null;
    console.log('Test database connection closed');
  }
}

/**
 * Wait for a specified duration
 * @param {number} ms - Milliseconds to wait
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} operation - Async operation to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} delay - Initial delay in milliseconds
 * @returns {Promise<any>} Operation result
 */
async function retryOperation(operation, maxAttempts = testConfig.retryAttempts, delay = testConfig.retryDelay) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`Attempt ${attempt}/${maxAttempts} failed:`, error.message);
      
      if (attempt < maxAttempts) {
        const waitTime = delay * Math.pow(2, attempt - 1); // Exponential backoff
        console.log(`Retrying in ${waitTime}ms...`);
        await wait(waitTime);
      }
    }
  }
  
  throw new Error(`Operation failed after ${maxAttempts} attempts: ${lastError.message}`);
}

/**
 * Check if Starknet RPC is accessible
 */
async function checkStarknetConnection() {
  try {
    const { RpcProvider } = require('starknet');
    const provider = new RpcProvider({ nodeUrl: testConfig.rpcUrl });
    
    // Try to get the latest block
    await provider.getBlock('latest');
    console.log('Starknet RPC connection successful');
    return true;
  } catch (error) {
    console.error('Starknet RPC connection failed:', error.message);
    return false;
  }
}

/**
 * Validate test configuration
 */
function validateTestConfig() {
  const errors = [];

  // Check required environment variables
  if (!testConfig.rpcUrl) {
    errors.push('STARKNET_RPC_URL is not set');
  }

  if (!testConfig.accounts.account1.address) {
    errors.push('TEST_ACCOUNT_1_ADDRESS is not set');
  }

  if (!testConfig.accounts.account1.privateKey) {
    errors.push('TEST_ACCOUNT_1_PRIVATE_KEY is not set');
  }

  // Warn about placeholder addresses
  if (testConfig.vesu.oracleAddress === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    console.warn('WARNING: VESU_ORACLE_ADDRESS is using placeholder value');
  }

  if (testConfig.vesu.pools['ETH-USDC'] === '0x0000000000000000000000000000000000000000000000000000000000000000') {
    console.warn('WARNING: VESU_ETH_USDC_POOL is using placeholder value');
  }

  if (errors.length > 0) {
    throw new Error(`Test configuration errors:\n${errors.join('\n')}`);
  }

  console.log('Test configuration validated successfully');
}

/**
 * Setup function to run before all tests
 */
async function setupTests() {
  console.log('Setting up E2E tests...');
  
  // Validate configuration
  validateTestConfig();
  
  // Check Starknet connection
  const isConnected = await checkStarknetConnection();
  if (!isConnected) {
    throw new Error('Cannot connect to Starknet RPC. Tests cannot proceed.');
  }
  
  // Initialize database
  await initializeDatabase();
  
  // Clean up any existing test data
  await cleanupDatabase();
  
  console.log('E2E test setup completed successfully');
}

/**
 * Teardown function to run after all tests
 */
async function teardownTests() {
  console.log('Tearing down E2E tests...');
  
  // Clean up test data
  await cleanupDatabase();
  
  // Close database connection
  await closeDatabase();
  
  console.log('E2E test teardown completed successfully');
}

module.exports = {
  testConfig,
  initializeDatabase,
  cleanupDatabase,
  closeDatabase,
  wait,
  retryOperation,
  checkStarknetConnection,
  validateTestConfig,
  setupTests,
  teardownTests
};
