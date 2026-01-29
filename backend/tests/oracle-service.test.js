// Mock dependencies before requiring the service
jest.mock('../config/starknet', () => ({
  getStarknetProvider: jest.fn(() => ({
    // Mock provider
  }))
}));

jest.mock('../config/vesu.config', () => ({
  getVesuConfig: jest.fn(() => ({
    oracle: {
      address: '0x36031daa264c24520b11d93af622c848b2499b66b41d611bac95e13cfca131a',
      priceStalenessTolerance: 300,
      cacheTTL: 60000
    }
  }))
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => JSON.stringify([]))
}));

const { PragmaOracleService, AggregationMode, ASSET_IDENTIFIERS } = require('../services/PragmaOracleService');

describe('PragmaOracleService', () => {
  let oracleService;

  beforeEach(() => {
    // Note: This will use the actual Starknet provider from config
    // For unit tests, we should mock the provider, but for now we'll test the structure
    oracleService = null; // Will be initialized when we have proper test setup
  });

  describe('ASSET_IDENTIFIERS', () => {
    test('should have all required assets', () => {
      expect(ASSET_IDENTIFIERS).toHaveProperty('ETH');
      expect(ASSET_IDENTIFIERS).toHaveProperty('BTC');
      expect(ASSET_IDENTIFIERS).toHaveProperty('USDC');
      expect(ASSET_IDENTIFIERS).toHaveProperty('USDT');
      expect(ASSET_IDENTIFIERS).toHaveProperty('STRK');
      expect(ASSET_IDENTIFIERS).toHaveProperty('DAI');
    });

    test('should have valid felt252 identifiers', () => {
      Object.values(ASSET_IDENTIFIERS).forEach(identifier => {
        expect(typeof identifier).toBe('string');
        expect(identifier.length).toBeGreaterThan(0);
      });
    });
  });

  describe('AggregationMode', () => {
    test('should have correct aggregation modes', () => {
      expect(AggregationMode.MEDIAN).toBe(0);
      expect(AggregationMode.MEAN).toBe(1);
      expect(AggregationMode.ERROR).toBe(255);
    });
  });

  describe('Class Structure', () => {
    test('should export PragmaOracleService class', () => {
      expect(PragmaOracleService).toBeDefined();
      expect(typeof PragmaOracleService).toBe('function');
    });

    test('should have all required methods', () => {
      const methods = [
        'assetToFelt252',
        'getCachedPrice',
        'setCachedPrice',
        'clearCache',
        'isPriceStale',
        'parseOracleResponse',
        'validatePriceData',
        'calculatePrice',
        'getPrice',
        'getPrices',
        'getPriceWithAggregation',
        'getPriceWithFallback',
        'healthCheck'
      ];

      methods.forEach(method => {
        expect(PragmaOracleService.prototype[method]).toBeDefined();
        expect(typeof PragmaOracleService.prototype[method]).toBe('function');
      });
    });
  });

  describe('assetToFelt252', () => {
    test('should convert supported assets to felt252', () => {
      // Create a minimal instance for testing utility methods
      const service = Object.create(PragmaOracleService.prototype);
      
      expect(service.assetToFelt252('ETH')).toBe(ASSET_IDENTIFIERS.ETH);
      expect(service.assetToFelt252('eth')).toBe(ASSET_IDENTIFIERS.ETH);
      expect(service.assetToFelt252('STRK')).toBe(ASSET_IDENTIFIERS.STRK);
    });

    test('should throw error for unsupported assets', () => {
      const service = Object.create(PragmaOracleService.prototype);
      
      expect(() => service.assetToFelt252('INVALID')).toThrow('Unsupported asset');
    });
  });

  describe('Cache Management', () => {
    let service;

    beforeEach(() => {
      service = Object.create(PragmaOracleService.prototype);
      service.priceCache = new Map();
      service.cacheTTL = 60000; // 1 minute
    });

    test('should store and retrieve cached prices', () => {
      const priceData = {
        price: '2500000000',
        decimals: 8,
        lastUpdatedTimestamp: Math.floor(Date.now() / 1000),
        numSourcesAggregated: 5
      };

      service.setCachedPrice('ETH', priceData);
      const cached = service.getCachedPrice('ETH');

      expect(cached).toBeDefined();
      expect(cached.price).toBe(priceData.price);
      expect(cached.decimals).toBe(priceData.decimals);
    });

    test('should return null for expired cache', (done) => {
      service.cacheTTL = 100; // 100ms for testing
      
      const priceData = {
        price: '2500000000',
        decimals: 8,
        lastUpdatedTimestamp: Math.floor(Date.now() / 1000),
        numSourcesAggregated: 5
      };

      service.setCachedPrice('ETH', priceData);

      setTimeout(() => {
        const cached = service.getCachedPrice('ETH');
        expect(cached).toBeNull();
        done();
      }, 150);
    });

    test('should clear all cached prices', () => {
      service.setCachedPrice('ETH', { price: '2500' });
      service.setCachedPrice('BTC', { price: '50000' });

      expect(service.priceCache.size).toBe(2);

      service.clearCache();

      expect(service.priceCache.size).toBe(0);
    });
  });

  describe('Price Staleness Validation', () => {
    let service;

    beforeEach(() => {
      service = Object.create(PragmaOracleService.prototype);
      service.priceStalenessTolerance = 300; // 5 minutes
    });

    test('should detect stale prices', () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      expect(service.isPriceStale(oldTimestamp)).toBe(true);
    });

    test('should accept fresh prices', () => {
      const recentTimestamp = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
      expect(service.isPriceStale(recentTimestamp)).toBe(false);
    });

    test('should use custom max age', () => {
      const timestamp = Math.floor(Date.now() / 1000) - 200; // 200 seconds ago
      expect(service.isPriceStale(timestamp, 100)).toBe(true);
      expect(service.isPriceStale(timestamp, 300)).toBe(false);
    });
  });

  describe('Price Data Validation', () => {
    let service;

    beforeEach(() => {
      service = Object.create(PragmaOracleService.prototype);
      service.priceStalenessTolerance = 300;
      service.isPriceStale = jest.fn().mockReturnValue(false);
    });

    test('should validate correct price data', () => {
      const priceData = {
        price: '2500000000',
        decimals: 8,
        lastUpdatedTimestamp: Math.floor(Date.now() / 1000),
        numSourcesAggregated: 5
      };

      expect(() => service.validatePriceData(priceData, 3)).not.toThrow();
    });

    test('should reject zero price', () => {
      const priceData = {
        price: '0',
        decimals: 8,
        lastUpdatedTimestamp: Math.floor(Date.now() / 1000),
        numSourcesAggregated: 5
      };

      expect(() => service.validatePriceData(priceData, 3)).toThrow('Invalid zero price');
    });

    test('should reject insufficient sources', () => {
      const priceData = {
        price: '2500000000',
        decimals: 8,
        lastUpdatedTimestamp: Math.floor(Date.now() / 1000),
        numSourcesAggregated: 2
      };

      expect(() => service.validatePriceData(priceData, 3)).toThrow('Insufficient price sources');
    });

    test('should reject stale prices', () => {
      service.isPriceStale = jest.fn().mockReturnValue(true);
      
      const priceData = {
        price: '2500000000',
        decimals: 8,
        lastUpdatedTimestamp: Math.floor(Date.now() / 1000) - 400,
        numSourcesAggregated: 5
      };

      expect(() => service.validatePriceData(priceData, 3)).toThrow('Price is stale');
    });
  });

  describe('parseOracleResponse', () => {
    let service;

    beforeEach(() => {
      service = Object.create(PragmaOracleService.prototype);
    });

    test('should parse oracle response correctly', () => {
      const response = [
        '2500000000',  // price
        8,             // decimals
        1706284800,    // lastUpdated
        5,             // numSources
        null           // expiration
      ];

      const parsed = service.parseOracleResponse(response);

      expect(parsed.price).toBe('2500000000');
      expect(parsed.decimals).toBe(8);
      expect(parsed.lastUpdatedTimestamp).toBe(1706284800);
      expect(parsed.numSourcesAggregated).toBe(5);
      expect(parsed.expiration).toBeNull();
    });

    test('should handle expiration timestamp', () => {
      const response = [
        '2500000000',
        8,
        1706284800,
        5,
        1706371200  // expiration
      ];

      const parsed = service.parseOracleResponse(response);
      expect(parsed.expiration).toBe(1706371200);
    });
  });
});
