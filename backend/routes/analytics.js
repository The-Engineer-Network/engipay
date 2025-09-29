const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/analytics/portfolio
router.get('/portfolio', authenticateToken, (req, res) => {
  const { period = '30d' } = req.query;

  res.json({
    period,
    performance: {
      total_return: 12.5,
      volatility: 0.15,
      sharpe_ratio: 1.8,
      max_drawdown: -5.2
    },
    asset_performance: [
      {
        asset: 'ETH',
        return: 8.5,
        allocation: 40.0
      }
    ]
  });
});

// GET /api/analytics/defi
router.get('/defi', authenticateToken, (req, res) => {
  res.json({
    total_value_locked: 4200.00,
    total_rewards_earned: 150.00,
    average_apy: 8.6,
    protocols_used: ['Vesu', 'Trove', 'Endurfi'],
    risk_distribution: {
      low: 60,
      medium: 30,
      high: 10
    }
  });
});

module.exports = router;