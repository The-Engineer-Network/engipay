/**
 * Price Service - CoinGecko Integration
 * Backend Dev 4 Task - Real-time price feeds
 * 
 * Features:
 * - Real-time cryptocurrency prices
 * - Multi-currency support
 * - Price history and charts
 * - Market data (volume, market cap, etc.)
 * - Caching for performance
 */

const axios = require('axios');

class PriceService {
  constructor() {
    // CoinGecko API configuration
    this.baseURL = process.env.COINGECKO_API_KEY 
      ? 'https://pro-api.coingecko.com/api/v3'
      : 'https://api.coingecko.com/api/v3';
    
    this.apiKey = process.env.COINGECKO_API_KEY || null;
    
    // Rate limiting: Free tier = 30 calls/minute, Pro = higher limits
    this.rateLimitDelay = this.apiKey ? 100 : 2000; // ms between requests
    this.lastRequestTime = 0;
    
    // Cache configuration
    this.cache = new Map();
    this.cacheTimeout = 60000; // 1 minute cache for prices
    
    // Supported coin mappings (CoinGecko IDs)
    this.coinMap = {
      'BTC': 'bitcoin',
      'ETH': 'ethereum',
      'STRK': 'starknet',
      'USDC': 'usd-coin',
      'USDT': 'tether',
      'DAI': 'dai',
      'WBTC': 'wrapped-bitcoin',
      'WETH': 'weth',
      'MATIC': 'matic-network',
      'BNB': 'binancecoin',
      'SOL': 'solana',
      'AVAX': 'avalanche-2',
      'LINK': 'chainlink',
      'UNI': 'uniswap',
      'AAVE': 'aave'
    };
    
    // Supported fiat currencies
    this.supportedCurrencies = ['usd', 'eur', 'gbp', 'jpy', 'cny', 'krw', 'inr'];
  }

  /**
   * Rate limiting helper
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.rateLimitDelay) {
      await new Promise(resolve => 
        setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
      );
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Make API request with error handling
   */
  async makeRequest(endpoint, params = {}) {
    await this.rateLimit();
    
    try {
      const headers = {};
      if (this.apiKey) {
        headers['x-cg-pro-api-key'] = this.apiKey;
      }
      
      const response = await axios.get(`${this.baseURL}${endpoint}`, {
        params,
        headers,
        timeout: 10000
      });
      
      return response.data;
    } catch (error) {
      console.error('CoinGecko API Error:', error.message);
      
      if (error.response) {
        throw new Error(`CoinGecko API Error: ${error.response.status} - ${error.response.data?.error || error.message}`);
      }
      
      throw new Error(`CoinGecko API Error: ${error.message}`);
    }
  }

  /**
   * Get cache key
   */
  getCacheKey(method, params) {
    return `${method}:${JSON.stringify(params)}`;
  }

  /**
   * Get from cache
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  /**
   * Set cache
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Clean old cache entries (keep last 100)
    if (this.cache.size > 100) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * Convert symbol to CoinGecko ID
   */
  getCoinId(symbol) {
    const upperSymbol = symbol.toUpperCase();
    return this.coinMap[upperSymbol] || symbol.toLowerCase();
  }

  /**
   * Get current price for single or multiple coins
   * @param {string|array} coins - Coin symbol(s) or CoinGecko ID(s)
   * @param {string|array} currencies - Currency code(s) (default: 'usd')
   * @param {boolean} includeMarketData - Include market cap, volume, etc.
   */
  async getPrice(coins, currencies = 'usd', includeMarketData = false) {
    const coinArray = Array.isArray(coins) ? coins : [coins];
    const currencyArray = Array.isArray(currencies) ? currencies : [currencies];
    
    // Convert symbols to CoinGecko IDs
    const coinIds = coinArray.map(coin => this.getCoinId(coin));
    
    const cacheKey = this.getCacheKey('price', { coinIds, currencyArray, includeMarketData });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const params = {
      ids: coinIds.join(','),
      vs_currencies: currencyArray.join(',')
    };
    
    if (includeMarketData) {
      params.include_market_cap = true;
      params.include_24hr_vol = true;
      params.include_24hr_change = true;
      params.include_last_updated_at = true;
    }
    
    const data = await this.makeRequest('/simple/price', params);
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Get detailed coin data
   */
  async getCoinData(coinId, localization = false, tickers = false, marketData = true) {
    const cacheKey = this.getCacheKey('coinData', { coinId, localization, tickers, marketData });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const params = {
      localization,
      tickers,
      market_data: marketData,
      community_data: false,
      developer_data: false
    };
    
    const data = await this.makeRequest(`/coins/${coinId}`, params);
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Get historical price data (OHLC)
   * @param {string} coinId - CoinGecko coin ID
   * @param {string} currency - Currency code
   * @param {number} days - Number of days (1, 7, 14, 30, 90, 180, 365, max)
   */
  async getHistoricalPrice(coinId, currency = 'usd', days = 7) {
    const cacheKey = this.getCacheKey('historical', { coinId, currency, days });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const params = {
      vs_currency: currency,
      days
    };
    
    const data = await this.makeRequest(`/coins/${coinId}/market_chart`, params);
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Get OHLC (candlestick) data
   * @param {string} coinId - CoinGecko coin ID
   * @param {string} currency - Currency code
   * @param {number} days - Number of days (1, 7, 14, 30, 90, 180, 365, max)
   */
  async getOHLC(coinId, currency = 'usd', days = 7) {
    const cacheKey = this.getCacheKey('ohlc', { coinId, currency, days });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const params = {
      vs_currency: currency,
      days
    };
    
    const data = await this.makeRequest(`/coins/${coinId}/ohlc`, params);
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Get market data for multiple coins
   */
  async getMarketData(coinIds, currency = 'usd', perPage = 100, page = 1) {
    const params = {
      vs_currency: currency,
      ids: Array.isArray(coinIds) ? coinIds.join(',') : coinIds,
      per_page: perPage,
      page,
      sparkline: false
    };
    
    return await this.makeRequest('/coins/markets', params);
  }

  /**
   * Get trending coins
   */
  async getTrending() {
    const cacheKey = this.getCacheKey('trending', {});
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const data = await this.makeRequest('/search/trending');
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Search for coins
   */
  async searchCoins(query) {
    const params = { query };
    return await this.makeRequest('/search', params);
  }

  /**
   * Get supported currencies
   */
  async getSupportedCurrencies() {
    const cacheKey = this.getCacheKey('currencies', {});
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const data = await this.makeRequest('/simple/supported_vs_currencies');
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Get global market data
   */
  async getGlobalData() {
    const cacheKey = this.getCacheKey('global', {});
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    
    const data = await this.makeRequest('/global');
    this.setCache(cacheKey, data);
    
    return data;
  }

  /**
   * Calculate portfolio value
   * @param {array} holdings - Array of {symbol, amount}
   * @param {string} currency - Currency code
   */
  async calculatePortfolioValue(holdings, currency = 'usd') {
    const symbols = holdings.map(h => h.symbol);
    const prices = await this.getPrice(symbols, currency, true);
    
    let totalValue = 0;
    const details = [];
    
    for (const holding of holdings) {
      const coinId = this.getCoinId(holding.symbol);
      const priceData = prices[coinId];
      
      if (priceData) {
        const value = holding.amount * priceData[currency];
        totalValue += value;
        
        details.push({
          symbol: holding.symbol,
          amount: holding.amount,
          price: priceData[currency],
          value,
          change24h: priceData[`${currency}_24h_change`] || 0
        });
      }
    }
    
    return {
      totalValue,
      currency,
      holdings: details,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get price change percentage
   */
  async getPriceChange(coinId, currency = 'usd', days = 7) {
    const historical = await this.getHistoricalPrice(coinId, currency, days);
    
    if (!historical.prices || historical.prices.length < 2) {
      return null;
    }
    
    const firstPrice = historical.prices[0][1];
    const lastPrice = historical.prices[historical.prices.length - 1][1];
    const change = ((lastPrice - firstPrice) / firstPrice) * 100;
    
    return {
      coinId,
      currency,
      days,
      firstPrice,
      lastPrice,
      changePercent: change,
      changeAbsolute: lastPrice - firstPrice
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
const priceService = new PriceService();

module.exports = priceService;
