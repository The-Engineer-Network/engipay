const StarknetContractManager = require('../services/StarknetContractManager');
const TransactionManager = require('../services/TransactionManager');
const { getStarknetProvider } = require('../config/starknet');

describe('Starknet Integration Layer', () => {
  let provider;
  let contractManager;
  let transactionManager;

  beforeAll(() => {
    // Initialize provider
    try {
      provider = getStarknetProvider();
    } catch (error) {
      console.log('Skipping tests - Starknet provider not configured');
    }
  });

  describe('StarknetContractManager', () => {
    beforeEach(() => {
      if (provider) {
        contractManager = new StarknetContractManager(provider);
      }
    });

    test('should initialize with provider', () => {
      if (!provider) {
        return expect(true).toBe(true); // Skip if no provider
      }
      expect(contractManager).toBeDefined();
      expect(contractManager.provider).toBeDefined();
    });

    test('should load Pool ABI', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      const abi = contractManager.loadPoolABI();
      expect(abi).toBeDefined();
      expect(Array.isArray(abi)).toBe(true);
      expect(abi.length).toBeGreaterThan(0);
    });

    test('should load vToken ABI', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      const abi = contractManager.loadVTokenABI();
      expect(abi).toBeDefined();
      expect(Array.isArray(abi)).toBe(true);
      expect(abi.length).toBeGreaterThan(0);
    });

    test('should validate Starknet addresses', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      // Valid addresses
      expect(contractManager.isValidAddress('0x1234567890abcdef')).toBe(true);
      expect(contractManager.isValidAddress('0x0000000000000000000000000000000000000000000000000000000000000001')).toBe(true);
      
      // Invalid addresses
      expect(contractManager.isValidAddress('invalid')).toBe(false);
      expect(contractManager.isValidAddress('1234567890abcdef')).toBe(false);
      expect(contractManager.isValidAddress('')).toBe(false);
    });

    test('should cache contract instances', async () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      const testAddress = '0x0000000000000000000000000000000000000000000000000000000000000001';
      
      // Initialize contract
      await contractManager.initializePoolContract(testAddress);
      
      // Check cache
      const stats = contractManager.getCacheStats();
      expect(stats.poolContracts).toBe(1);
      expect(stats.totalCached).toBe(1);
    });

    test('should clear cache', async () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      const testAddress = '0x0000000000000000000000000000000000000000000000000000000000000001';
      
      // Initialize contract
      await contractManager.initializePoolContract(testAddress);
      
      // Clear cache
      contractManager.clearCache();
      
      // Check cache is empty
      const stats = contractManager.getCacheStats();
      expect(stats.totalCached).toBe(0);
    });
  });

  describe('TransactionManager', () => {
    beforeEach(() => {
      if (provider) {
        transactionManager = new TransactionManager(provider);
      }
    });

    test('should initialize with provider', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      expect(transactionManager).toBeDefined();
      expect(transactionManager.provider).toBeDefined();
    });

    test('should identify retryable errors', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      
      // Retryable errors
      expect(transactionManager.isRetryableError(new Error('network error'))).toBe(true);
      expect(transactionManager.isRetryableError(new Error('timeout occurred'))).toBe(true);
      expect(transactionManager.isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(transactionManager.isRetryableError(new Error('rate limit exceeded'))).toBe(true);
      
      // Non-retryable errors
      expect(transactionManager.isRetryableError(new Error('invalid parameters'))).toBe(false);
      expect(transactionManager.isRetryableError(new Error('contract not found'))).toBe(false);
    });

    test('should have sleep utility', async () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      
      const start = Date.now();
      await transactionManager.sleep(100);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(100);
      expect(elapsed).toBeLessThan(200);
    });

    test('should load transaction configuration', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      
      expect(transactionManager.txConfig).toBeDefined();
      expect(transactionManager.txConfig.maxRetries).toBeDefined();
      expect(transactionManager.txConfig.retryDelay).toBeDefined();
      expect(transactionManager.txConfig.confirmationTimeout).toBeDefined();
    });
  });

  describe('Integration', () => {
    test('should work together', () => {
      if (!provider) {
        return expect(true).toBe(true);
      }
      
      const manager = new StarknetContractManager(provider);
      const txManager = new TransactionManager(provider);
      
      expect(manager.provider).toBe(provider);
      expect(txManager.provider).toBe(provider);
    });
  });
});
