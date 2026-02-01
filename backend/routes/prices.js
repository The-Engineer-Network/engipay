/**
 * Price Routes - CoinGecko Integration
 * Backend Dev 4 Task
 */

const express = require('express');
const router = express.Router();
const priceService = require('../services/priceService');
const { authenticate } = require('../middleware/auth');

/**
 * GET /api/prices/current
 * Get current price for one or multiple coins
 * Query params: coins (comma-separated), currencies (comma-separated), includeMarketData (boolean)
 */
router.get('/current', async (req, res) => {
  try {
    const { coins, currencies = 'usd', includeMarketData = 'false' } = req.query;

    if (!coins) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETER',
          message: 'coins parameter is required'
        }
      });
    }

    const coinArray = coins.split(',').map(c => c.trim());
    const currencyArray = currencies.split(',').map(c => c.trim());
    const includeData = includeMarketData === 'true';

    const prices = await priceService.getPrice(coinArray, currencyArray, includeData);

    res.json({
      success: true,
      data: prices,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Price fetch error:', error);
    res.status(500).json({
      error: {
        code: 'PRICE_FETCH_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/coin/:coinId
 * Get detailed coin data
 */
router.get('/coin/:coinId', async (req, res) => {
  try {
    const { coinId } = req.params;
    const { localization = 'false', tickers = 'false', marketData = 'true' } = req.query;

    const data = await priceService.getCoinData(
      coinId,
      localization === 'true',
      tickers === 'true',
      marketData === 'true'
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Coin data fetch error:', error);
    res.status(500).json({
      error: {
        code: 'COIN_DATA_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/historical/:coinId
 * Get historical price data
 * Query params: currency, days
 */
router.get('/historical/:coinId', async (req, res) => {
  try {
    const { coinId } = req.params;
    const { currency = 'usd', days = '7' } = req.query;

    const data = await priceService.getHistoricalPrice(
      coinId,
      currency,
      parseInt(days)
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Historical price fetch error:', error);
    res.status(500).json({
      error: {
        code: 'HISTORICAL_PRICE_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/ohlc/:coinId
 * Get OHLC (candlestick) data
 * Query params: currency, days
 */
router.get('/ohlc/:coinId', async (req, res) => {
  try {
    const { coinId } = req.params;
    const { currency = 'usd', days = '7' } = req.query;

    const data = await priceService.getOHLC(
      coinId,
      currency,
      parseInt(days)
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('OHLC fetch error:', error);
    res.status(500).json({
      error: {
        code: 'OHLC_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/market
 * Get market data for multiple coins
 * Query params: coins, currency, perPage, page
 */
router.get('/market', async (req, res) => {
  try {
    const { coins, currency = 'usd', perPage = '100', page = '1' } = req.query;

    if (!coins) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETER',
          message: 'coins parameter is required'
        }
      });
    }

    const data = await priceService.getMarketData(
      coins,
      currency,
      parseInt(perPage),
      parseInt(page)
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Market data fetch error:', error);
    res.status(500).json({
      error: {
        code: 'MARKET_DATA_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/trending
 * Get trending coins
 */
router.get('/trending', async (req, res) => {
  try {
    const data = await priceService.getTrending();

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Trending fetch error:', error);
    res.status(500).json({
      error: {
        code: 'TRENDING_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/search
 * Search for coins
 * Query params: query
 */
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({
        error: {
          code: 'MISSING_PARAMETER',
          message: 'query parameter is required'
        }
      });
    }

    const data = await priceService.searchCoins(query);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      error: {
        code: 'SEARCH_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/currencies
 * Get supported currencies
 */
router.get('/currencies', async (req, res) => {
  try {
    const data = await priceService.getSupportedCurrencies();

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Currencies fetch error:', error);
    res.status(500).json({
      error: {
        code: 'CURRENCIES_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/global
 * Get global market data
 */
router.get('/global', async (req, res) => {
  try {
    const data = await priceService.getGlobalData();

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Global data fetch error:', error);
    res.status(500).json({
      error: {
        code: 'GLOBAL_DATA_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/prices/portfolio-value
 * Calculate portfolio value
 * Body: { holdings: [{ symbol, amount }], currency }
 */
router.post('/portfolio-value', authenticate, async (req, res) => {
  try {
    const { holdings, currency = 'usd' } = req.body;

    if (!holdings || !Array.isArray(holdings)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_HOLDINGS',
          message: 'holdings must be an array of { symbol, amount }'
        }
      });
    }

    const data = await priceService.calculatePortfolioValue(holdings, currency);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Portfolio value calculation error:', error);
    res.status(500).json({
      error: {
        code: 'PORTFOLIO_VALUE_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * GET /api/prices/change/:coinId
 * Get price change percentage
 * Query params: currency, days
 */
router.get('/change/:coinId', async (req, res) => {
  try {
    const { coinId } = req.params;
    const { currency = 'usd', days = '7' } = req.query;

    const data = await priceService.getPriceChange(
      coinId,
      currency,
      parseInt(days)
    );

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('Price change fetch error:', error);
    res.status(500).json({
      error: {
        code: 'PRICE_CHANGE_ERROR',
        message: error.message
      }
    });
  }
});

/**
 * POST /api/prices/clear-cache
 * Clear price cache (admin only)
 */
router.post('/clear-cache', authenticate, async (req, res) => {
  try {
    // TODO: Add admin check
    priceService.clearCache();

    res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({
      error: {
        code: 'CACHE_CLEAR_ERROR',
        message: error.message
      }
    });
  }
});

module.exports = router;
