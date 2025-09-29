const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Mock portfolio data (replace with real blockchain data in production)
const mockBalances = {
  '0x1234567890123456789012345678901234567890': [
    {
      symbol: 'ETH',
      name: 'Ethereum',
      balance: '1.234567',
      value_usd: 2456.78,
      change_24h: 2.5,
      icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
      chain: 'ethereum',
      contract_address: '0x0000000000000000000000000000000000000000'
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      balance: '500.00',
      value_usd: 500.00,
      change_24h: -0.1,
      icon: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png',
      chain: 'ethereum',
      contract_address: '0xA0b86a33E6441e88C5F2712C3E9b74F5c4d6E3E9'
    }
  ]
};

// GET /api/portfolio/balances
router.get('/balances', authenticateToken, (req, res) => {
  try {
    const { chain, include_zero } = req.query;
    const walletAddress = req.user.walletAddress.toLowerCase();

    let balances = mockBalances[walletAddress] || [];

    // Filter by chain if specified
    if (chain) {
      balances = balances.filter(balance => balance.chain === chain);
    }

    // Filter zero balances if not requested
    if (include_zero !== 'true') {
      balances = balances.filter(balance => parseFloat(balance.balance) > 0);
    }

    const totalValue = balances.reduce((sum, balance) => sum + balance.value_usd, 0);
    const totalChange24h = balances.reduce((sum, balance) => {
      return sum + (balance.change_24h * balance.value_usd / 100);
    }, 0);

    res.json({
      total_value_usd: totalValue,
      total_change_24h: totalChange24h,
      assets: balances
    });
  } catch (error) {
    console.error('Portfolio balances error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch portfolio balances'
      }
    });
  }
});

// GET /api/portfolio/history
router.get('/history', authenticateToken, (req, res) => {
  try {
    const { period = '30d', interval = '1d' } = req.query;

    // Mock historical data
    const mockHistory = [];
    const now = new Date();
    const periods = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    };

    const days = periods[period] || 30;
    let value = 6000;

    for (let i = days; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);

      value += (Math.random() - 0.5) * 200; // Random fluctuation

      mockHistory.push({
        timestamp: date.toISOString(),
        value_usd: Math.max(5000, value),
        change_percent: (Math.random() - 0.5) * 10
      });
    }

    res.json({
      period,
      interval,
      data: mockHistory
    });
  } catch (error) {
    console.error('Portfolio history error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch portfolio history'
      }
    });
  }
});

// GET /api/portfolio/performance
router.get('/performance', authenticateToken, (req, res) => {
  try {
    const walletAddress = req.user.walletAddress.toLowerCase();
    const balances = mockBalances[walletAddress] || [];

    const totalReturn = 12.5;
    const totalReturnUsd = 750.00;

    const bestPerformer = balances.reduce((best, current) => {
      return current.change_24h > best.change_24h ? current : best;
    }, balances[0] || { symbol: 'N/A', change_24h: 0 });

    const worstPerformer = balances.reduce((worst, current) => {
      return current.change_24h < worst.change_24h ? current : worst;
    }, balances[0] || { symbol: 'N/A', change_24h: 0 });

    const assetAllocation = balances.map(asset => ({
      asset: asset.symbol,
      percentage: (asset.value_usd / balances.reduce((sum, b) => sum + b.value_usd, 0)) * 100,
      value_usd: asset.value_usd
    }));

    res.json({
      total_return: totalReturn,
      total_return_usd: totalReturnUsd,
      best_performer: {
        symbol: bestPerformer.symbol,
        change_percent: bestPerformer.change_24h
      },
      worst_performer: {
        symbol: worstPerformer.symbol,
        change_percent: worstPerformer.change_24h
      },
      asset_allocation: assetAllocation
    });
  } catch (error) {
    console.error('Portfolio performance error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch portfolio performance'
      }
    });
  }
});

module.exports = router;