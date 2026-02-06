const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const defiAnalyticsService = require('../services/DeFiAnalyticsService');
const yieldTrackingService = require('../services/YieldTrackingService');

const router = express.Router();

/**
 * @route   GET /api/analytics/portfolio
 * @desc    Get comprehensive portfolio analytics
 * @access  Private
 */
router.get('/portfolio', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { period = '30d' } = req.query;

    const analytics = await defiAnalyticsService.getPortfolioAnalytics(userId);

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error getting portfolio analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/defi
 * @desc    Get DeFi-specific analytics
 * @access  Private
 */
router.get('/defi', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const analytics = await defiAnalyticsService.getPortfolioAnalytics(userId);
    const riskMetrics = await defiAnalyticsService.getRiskMetrics(userId);

    res.json({
      success: true,
      data: {
        total_value_locked: analytics.totalValueLocked,
        total_debt: analytics.totalDebt,
        net_value: analytics.netValue,
        total_rewards_earned: analytics.totalYieldEarned,
        average_apy: analytics.averageAPY,
        position_count: analytics.positionCount,
        health_score: analytics.healthScore,
        risk_level: analytics.riskLevel,
        risk_metrics: riskMetrics,
        positions: analytics.positions
      }
    });
  } catch (error) {
    console.error('Error getting DeFi analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/yield
 * @desc    Get yield performance analytics
 * @access  Private
 */
router.get('/yield', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const yieldPerformance = await defiAnalyticsService.getYieldPerformance(
      userId,
      parseInt(days)
    );

    res.json({
      success: true,
      data: yieldPerformance
    });
  } catch (error) {
    console.error('Error getting yield analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/risk
 * @desc    Get risk metrics for portfolio
 * @access  Private
 */
router.get('/risk', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const riskMetrics = await defiAnalyticsService.getRiskMetrics(userId);

    res.json({
      success: true,
      data: riskMetrics
    });
  } catch (error) {
    console.error('Error getting risk metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/protocol
 * @desc    Get protocol-wide analytics
 * @access  Public
 */
router.get('/protocol', async (req, res) => {
  try {
    const protocolAnalytics = await defiAnalyticsService.getProtocolAnalytics();

    res.json({
      success: true,
      data: protocolAnalytics
    });
  } catch (error) {
    console.error('Error getting protocol analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/protocol/comparison
 * @desc    Get protocol comparison analytics
 * @access  Public
 */
router.get('/protocol/comparison', async (req, res) => {
  try {
    const comparison = await defiAnalyticsService.getProtocolComparison();

    res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    console.error('Error getting protocol comparison:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/position/:positionId/yield
 * @desc    Get yield data for specific position
 * @access  Private
 */
router.get('/position/:positionId/yield', authenticateToken, async (req, res) => {
  try {
    const { positionId } = req.params;

    const yieldData = await yieldTrackingService.getPositionYield(positionId);

    res.json({
      success: true,
      data: yieldData
    });
  } catch (error) {
    console.error('Error getting position yield:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   POST /api/analytics/position/:positionId/snapshot
 * @desc    Create yield snapshot for position
 * @access  Private
 */
router.post('/position/:positionId/snapshot', authenticateToken, async (req, res) => {
  try {
    const { positionId } = req.params;

    const snapshot = await yieldTrackingService.createYieldSnapshot(positionId);

    res.json({
      success: true,
      data: snapshot
    });
  } catch (error) {
    console.error('Error creating yield snapshot:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * @route   GET /api/analytics/dashboard
 * @desc    Get comprehensive dashboard analytics
 * @access  Private
 */
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all analytics in parallel
    const [
      portfolioAnalytics,
      riskMetrics,
      yieldPerformance,
      protocolAnalytics
    ] = await Promise.all([
      defiAnalyticsService.getPortfolioAnalytics(userId),
      defiAnalyticsService.getRiskMetrics(userId),
      defiAnalyticsService.getYieldPerformance(userId, 30),
      defiAnalyticsService.getProtocolAnalytics()
    ]);

    res.json({
      success: true,
      data: {
        portfolio: portfolioAnalytics,
        risk: riskMetrics,
        yield: yieldPerformance,
        protocol: protocolAnalytics
      }
    });
  } catch (error) {
    console.error('Error getting dashboard analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
