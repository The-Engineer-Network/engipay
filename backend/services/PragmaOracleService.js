const { Contract } = require('starknet');
const fs = require('fs');
const path = require('path');
const Decimal = require('decimal.js');
const { getStarknetProvider } = require('../config/starknet');
const { getVesuConfig } = require('../config/vesu.config');

/**
 * Aggregation modes for Pragma Oracle
 */
const AggregationMode = {
  MEDIAN: 0,
  MEAN: 1,
  ERROR: 255
};

/**
 * Asset identifier mapping (asset symbol to felt252)
 * Based on Pragma Oracle asset pairs
 * These are the felt252 representations of asset pair strings (e.g., "ETH/USD")
 */
const ASSET_IDENTIFIERS = {
  'ETH': '19514442401534788',      // ETH/USD
  'BTC': '18669995996566340',      // BTC/USD
  'USDC': '6148333044652921668',   // USDC/USD
  'USDT': '6148333044652922708',   // USDT/USD
  'STRK': '6004514686061859652',   // STRK/USD
  'DAI': '19212080998863684'       // DAI/USD
};

/**
 * PragmaOracleService
 * 
 * Service for fetching price data from Pragma Oracle on Starknet.
 * Implements caching, staleness validation, and fallback mechanisms.
 */
class PragmaOracleService {
  constructor(oracleAddress = null, provider = null) {
    this.provider = provider;
    this.providerInitialized = !!provider;
    
    const config = getVesuConfig();
    this.oracleAddress = oracleAddress || config.oracle.address;
    this.priceStalenessTolerance = config.oracle.priceStalenessTolerance || 300; // 5 minutes default
    this.cacheTTL = config.oracle.cacheTTL || 60000; // 1 minute default
    
    // Price cache: Map<asset, { price, decimals, timestamp, lastUpdated, numSources }>
    this.priceCache = new Map();
    
    // Load Oracle ABI
    const abiPath = path.join(__dirname, '../abis/pragma-oracle-abi.json');
    const oracleABI = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
    
    // Initialize contract (will be lazy-loaded if provider not provided)
    this.oracleABI = oracleABI;
    this.oracleContract = null;
  }

  /**
   * Ensure provider and contract are initialized
   */
  _ensureInitialized() {
    if (!this.providerInitialized) {
      this.provider = getStarknetProvider();
      this.providerInitialized = true;
    }
    
    if (!this.oracleContract) {
      this.oracleContract = new Contract(this.oracleABI, this.oracleAddress, this.provider);
    }
  }

  /**
   * Convert asset symbol to felt252 identifier
   */
  assetToFelt252(asset) {
    const identifier = ASSET_IDENTIFIERS[asset.toUpperCase()];
    if (!identifier) {
      throw new Error(`Unsupported asset: ${asset}`);
    }
    return identifier;
  }

  /**
   * Check if cached price exists and is not expired
   */
  getCachedPrice(asset) {
    const cached = this.priceCache.get(asset.toUpperCase());
    if (!cached) {
      return null;
    }
    
    const now = Date.now();
    if (now - cached.cacheTimestamp > this.cacheTTL) {
      // Cache expired
      return null;
    }
    
    return cached;
  }

  /**
   * Store price in cache
   */
  setCachedPrice(asset, priceData) {
    this.priceCache.set(asset.toUpperCase(), {
      ...priceData,
      cacheTimestamp: Date.now()
    });
  }

  /**
   * Clear all cached prices
   */
  clearCache() {
    this.priceCache.clear();
  }

  /**
   * Check if price data is stale
   */
  isPriceStale(lastUpdatedTimestamp, maxAge = null) {
    const maxAgeSeconds = maxAge || this.priceStalenessTolerance;
    const currentTime = Math.floor(Date.now() / 1000);
    return (currentTime - lastUpdatedTimestamp) > maxAgeSeconds;
  }

  /**
   * Parse Pragma Oracle response
   * Response format: (price: u128, decimals: u32, last_updated: u64, num_sources: u32, expiration: Option<u64>)
   */
  parseOracleResponse(response) {
    // Response is a tuple: [price, decimals, last_updated_timestamp, num_sources_aggregated, expiration]
    const [price, decimals, lastUpdated, numSources, expiration] = response;
    
    return {
      price: BigInt(price).toString(),
      decimals: Number(decimals),
      lastUpdatedTimestamp: Number(lastUpdated),
      numSourcesAggregated: Number(numSources),
      expiration: expiration ? Number(expiration) : null
    };
  }

  /**
   * Validate price data meets quality requirements
   */
  validatePriceData(priceData, minSources = 3) {
    // Check non-zero price
    if (priceData.price === '0' || priceData.price === 0) {
      throw new Error('Invalid zero price from oracle');
    }

    // Check staleness
    if (this.isPriceStale(priceData.lastUpdatedTimestamp)) {
      throw new Error(
        `Price is stale. Last updated: ${priceData.lastUpdatedTimestamp}, ` +
        `current time: ${Math.floor(Date.now() / 1000)}, ` +
        `tolerance: ${this.priceStalenessTolerance}s`
      );
    }

    // Check source count
    if (priceData.numSourcesAggregated < minSources) {
      throw new Error(
        `Insufficient price sources. Got ${priceData.numSourcesAggregated}, ` +
        `minimum required: ${minSources}`
      );
    }

    return true;
  }

  /**
   * Calculate actual price value from oracle response
   */
  calculatePrice(priceData) {
    const price = new Decimal(priceData.price);
    const divisor = new Decimal(10).pow(priceData.decimals);
    return price.div(divisor);
  }


  /**
   * Fetch price for a single asset using median aggregation
   * Implements caching and validation
   */
  async getPrice(asset, options = {}) {
    const { skipCache = false, minSources = 3 } = options;

    // Check cache first unless skipCache is true
    if (!skipCache) {
      const cached = this.getCachedPrice(asset);
      if (cached) {
        return {
          asset: asset.toUpperCase(),
          price: this.calculatePrice(cached).toString(),
          priceRaw: cached.price,
          decimals: cached.decimals,
          lastUpdatedTimestamp: cached.lastUpdatedTimestamp,
          numSourcesAggregated: cached.numSourcesAggregated,
          cached: true
        };
      }
    }

    // Ensure provider and contract are initialized
    this._ensureInitialized();

    // Fetch from oracle
    const assetId = this.assetToFelt252(asset);
    
    try {
      const response = await this.oracleContract.get_data_median(assetId);
      const priceData = this.parseOracleResponse(response);
      
      // Validate price data
      this.validatePriceData(priceData, minSources);
      
      // Cache the result
      this.setCachedPrice(asset, priceData);
      
      return {
        asset: asset.toUpperCase(),
        price: this.calculatePrice(priceData).toString(),
        priceRaw: priceData.price,
        decimals: priceData.decimals,
        lastUpdatedTimestamp: priceData.lastUpdatedTimestamp,
        numSourcesAggregated: priceData.numSourcesAggregated,
        cached: false
      };
    } catch (error) {
      throw new Error(`Failed to fetch price for ${asset}: ${error.message}`);
    }
  }

  /**
   * Fetch prices for multiple assets in batch
   * More efficient than calling getPrice multiple times
   */
  async getPrices(assets, options = {}) {
    const { skipCache = false, minSources = 3 } = options;
    
    // Ensure provider and contract are initialized
    this._ensureInitialized();
    
    const results = {};
    const assetsToFetch = [];
    
    // Check cache for each asset
    for (const asset of assets) {
      if (!skipCache) {
        const cached = this.getCachedPrice(asset);
        if (cached) {
          results[asset.toUpperCase()] = {
            asset: asset.toUpperCase(),
            price: this.calculatePrice(cached).toString(),
            priceRaw: cached.price,
            decimals: cached.decimals,
            lastUpdatedTimestamp: cached.lastUpdatedTimestamp,
            numSourcesAggregated: cached.numSourcesAggregated,
            cached: true
          };
          continue;
        }
      }
      assetsToFetch.push(asset);
    }
    
    // Fetch remaining assets from oracle
    const fetchPromises = assetsToFetch.map(async (asset) => {
      try {
        const assetId = this.assetToFelt252(asset);
        const response = await this.oracleContract.get_data_median(assetId);
        const priceData = this.parseOracleResponse(response);
        
        // Validate price data
        this.validatePriceData(priceData, minSources);
        
        // Cache the result
        this.setCachedPrice(asset, priceData);
        
        return {
          asset: asset.toUpperCase(),
          price: this.calculatePrice(priceData).toString(),
          priceRaw: priceData.price,
          decimals: priceData.decimals,
          lastUpdatedTimestamp: priceData.lastUpdatedTimestamp,
          numSourcesAggregated: priceData.numSourcesAggregated,
          cached: false
        };
      } catch (error) {
        // Return error for this asset but don't fail entire batch
        return {
          asset: asset.toUpperCase(),
          error: error.message
        };
      }
    });
    
    const fetchedResults = await Promise.all(fetchPromises);
    
    // Merge results
    for (const result of fetchedResults) {
      results[result.asset] = result;
    }
    
    return results;
  }

  /**
   * Fetch price with specific aggregation mode
   */
  async getPriceWithAggregation(asset, aggregationMode = AggregationMode.MEDIAN, options = {}) {
    const { minSources = 3 } = options;
    
    // Ensure provider and contract are initialized
    this._ensureInitialized();
    
    const assetId = this.assetToFelt252(asset);
    
    try {
      const response = await this.oracleContract.get_data(assetId, aggregationMode);
      const priceData = this.parseOracleResponse(response);
      
      // Validate price data
      this.validatePriceData(priceData, minSources);
      
      return {
        asset: asset.toUpperCase(),
        price: this.calculatePrice(priceData).toString(),
        priceRaw: priceData.price,
        decimals: priceData.decimals,
        lastUpdatedTimestamp: priceData.lastUpdatedTimestamp,
        numSourcesAggregated: priceData.numSourcesAggregated,
        aggregationMode: aggregationMode
      };
    } catch (error) {
      throw new Error(`Failed to fetch price for ${asset} with aggregation mode ${aggregationMode}: ${error.message}`);
    }
  }

  /**
   * Get price with fallback mechanism
   * Tries median first, then mean, then cached price
   */
  async getPriceWithFallback(asset, options = {}) {
    const { minSources = 3 } = options;
    
    // Try median first
    try {
      return await this.getPrice(asset, { skipCache: false, minSources });
    } catch (medianError) {
      console.warn(`Median aggregation failed for ${asset}:`, medianError.message);
      
      // Try mean aggregation
      try {
        const result = await this.getPriceWithAggregation(asset, AggregationMode.MEAN, { minSources });
        console.log(`Using mean aggregation for ${asset}`);
        return result;
      } catch (meanError) {
        console.warn(`Mean aggregation failed for ${asset}:`, meanError.message);
        
        // Try cached price as last resort
        const cached = this.getCachedPrice(asset);
        if (cached) {
          console.warn(`Using cached price for ${asset} (may be stale)`);
          return {
            asset: asset.toUpperCase(),
            price: this.calculatePrice(cached).toString(),
            priceRaw: cached.price,
            decimals: cached.decimals,
            lastUpdatedTimestamp: cached.lastUpdatedTimestamp,
            numSourcesAggregated: cached.numSourcesAggregated,
            cached: true,
            fallback: true
          };
        }
        
        // All methods failed
        throw new Error(
          `Unable to fetch price for ${asset} from any source. ` +
          `Median error: ${medianError.message}, Mean error: ${meanError.message}`
        );
      }
    }
  }

  /**
   * Health check - verify oracle is accessible and returning data
   */
  async healthCheck() {
    try {
      // Try to fetch ETH price as a health check
      const result = await this.getPrice('ETH', { skipCache: true, minSources: 1 });
      return {
        healthy: true,
        oracleAddress: this.oracleAddress,
        testAsset: 'ETH',
        price: result.price,
        lastUpdated: result.lastUpdatedTimestamp,
        numSources: result.numSourcesAggregated
      };
    } catch (error) {
      return {
        healthy: false,
        oracleAddress: this.oracleAddress,
        error: error.message
      };
    }
  }
}

module.exports = {
  PragmaOracleService,
  AggregationMode,
  ASSET_IDENTIFIERS
};
