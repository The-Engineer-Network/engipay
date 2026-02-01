const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const analyticsService = require('../services/analyticsService');

const router = express.Router();

// GET /api/analytics/portfolio
router.get('/portfolio', authenticateToken, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user.id;

    const analytics = await analyticsService.getPortfolioAnalytics(userId, period);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Portfolio analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch portfolio analytics'
    });
  }
});

// GET /api/analytics/defi
router.get('/defi', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const analytics = await analyticsService.getDeFiAnalytics(userId);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('DeFi analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch DeFi analytics'
    });
  }
});

// GET /api/analytics/transactions
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user.id;

    const analytics = await analyticsService.getTransactionAnalytics(userId, period);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Transaction analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch transaction analytics'
    });
  }
});

// GET /api/analytics/rewards
router.get('/rewards', authenticateToken, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user.id;

    const analytics = await analyticsService.getRewardsAnalytics(userId, period);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Rewards analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch rewards analytics'
    });
  }
});

// GET /api/analytics/swaps
router.get('/swaps', authenticateToken, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const userId = req.user.id;

    const analytics = await analyticsService.getSwapAnalytics(userId, period);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Swap analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch swap analytics'
    });
  }
});

module.exports = router;