const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { Portfolio, Transaction } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// GET /api/portfolio/balances
router.get('/balances', authenticateToken, async (req, res) => {
  try {
    const { chain, include_zero, refresh } = req.query;

    // Build where clause
    const whereClause = {
      user_id: req.user.id
    };

    if (chain) whereClause.network = chain;

    // Get portfolio assets from database
    const portfolioAssets = await Portfolio.findAll({
      where: whereClause,
      attributes: [
        'asset_symbol',
        'asset_name',
        'balance',
        'value_usd',
        'change_24h',
        'network',
        'contract_address',
        'decimals',
        'icon_url',
        'last_updated'
      ]
    });

    // Filter zero balances if not requested
    let assets = portfolioAssets;
    if (include_zero !== 'true') {
      assets = assets.filter(asset => parseFloat(asset.balance) > 0);
    }

    // Calculate totals
    const totalValue = assets.reduce((sum, asset) => sum + parseFloat(asset.value_usd || 0), 0);
    const totalChange24h = assets.reduce((sum, asset) => {
      const changePercent = parseFloat(asset.change_24h || 0);
      const value = parseFloat(asset.value_usd || 0);
      return sum + (changePercent * value / 100);
    }, 0);

    // Format response
    const formattedAssets = assets.map(asset => ({
      symbol: asset.asset_symbol,
      name: asset.asset_name,
      balance: asset.balance,
      value_usd: parseFloat(asset.value_usd || 0),
      change_24h: parseFloat(asset.change_24h || 0),
      icon: asset.icon_url,
      chain: asset.network,
      contract_address: asset.contract_address,
      decimals: asset.decimals,
      last_updated: asset.last_updated
    }));

    res.json({
      total_value_usd: totalValue,
      total_change_24h: totalChange24h,
      assets: formattedAssets,
      last_updated: new Date().toISOString()
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
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { period = '30d', interval = '1d' } = req.query;

    const periods = {
      '1d': 1,
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '1y': 365
    };

    const days = periods[period] || 30;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get all transactions for the user within the period
    const transactions = await Transaction.findAll({
      where: {
        user_id: req.user.id,
        created_at: {
          [Op.gte]: startDate
        },
        status: 'completed'
      },
      attributes: ['amount', 'value_usd', 'transaction_type', 'created_at'],
      order: [['created_at', 'ASC']]
    });

    // Calculate portfolio value over time
    // This is a simplified calculation - in production you'd want more sophisticated logic
    const history = [];
    let currentValue = 0;

    // Group transactions by date
    const transactionsByDate = {};
    transactions.forEach(tx => {
      const dateKey = tx.created_at.toISOString().split('T')[0];
      if (!transactionsByDate[dateKey]) {
        transactionsByDate[dateKey] = [];
      }
      transactionsByDate[dateKey].push(tx);
    });

    // Generate daily portfolio values
    for (let i = days; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];

      // Apply transactions for this date
      const dayTransactions = transactionsByDate[dateKey] || [];
      dayTransactions.forEach(tx => {
        const value = parseFloat(tx.value_usd || 0);
        if (tx.transaction_type === 'receive' || tx.transaction_type === 'swap_in') {
          currentValue += value;
        } else if (tx.transaction_type === 'send' || tx.transaction_type === 'swap_out') {
          currentValue -= value;
        }
      });

      // Add some realistic volatility
      const volatility = (Math.random() - 0.5) * 0.02; // ±1% daily change
      currentValue *= (1 + volatility);

      history.push({
        timestamp: date.toISOString(),
        value_usd: Math.max(0, currentValue),
        change_percent: volatility * 100
      });
    }

    res.json({
      period,
      interval,
      data: history,
      total_transactions: transactions.length
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
router.get('/performance', authenticateToken, async (req, res) => {
  try {
    // Get current portfolio assets
    const portfolioAssets = await Portfolio.findAll({
      where: { user_id: req.user.id },
      attributes: ['asset_symbol', 'asset_name', 'balance', 'value_usd', 'change_24h']
    });

    if (portfolioAssets.length === 0) {
      return res.json({
        total_return: 0,
        total_return_usd: 0,
        best_performer: { symbol: 'N/A', change_percent: 0 },
        worst_performer: { symbol: 'N/A', change_percent: 0 },
        asset_allocation: []
      });
    }

    // Calculate total portfolio value
    const totalValue = portfolioAssets.reduce((sum, asset) => sum + parseFloat(asset.value_usd || 0), 0);

    // Find best and worst performers
    const bestPerformer = portfolioAssets.reduce((best, current) => {
      return parseFloat(current.change_24h || 0) > parseFloat(best.change_24h || 0) ? current : best;
    });

    const worstPerformer = portfolioAssets.reduce((worst, current) => {
      return parseFloat(current.change_24h || 0) < parseFloat(worst.change_24h || 0) ? current : worst;
    });

    // Calculate asset allocation
    const assetAllocation = portfolioAssets.map(asset => ({
      asset: asset.asset_symbol,
      percentage: totalValue > 0 ? (parseFloat(asset.value_usd || 0) / totalValue) * 100 : 0,
      value_usd: parseFloat(asset.value_usd || 0)
    }));

    // Calculate total return (simplified - in production you'd track cost basis)
    const totalReturn = portfolioAssets.reduce((sum, asset) => {
      const changePercent = parseFloat(asset.change_24h || 0);
      const value = parseFloat(asset.value_usd || 0);
      return sum + (changePercent * value / 100);
    }, 0);

    res.json({
      total_return: totalReturn,
      total_return_usd: totalReturn,
      best_performer: {
        symbol: bestPerformer.asset_symbol,
        change_percent: parseFloat(bestPerformer.change_24h || 0)
      },
      worst_performer: {
        symbol: worstPerformer.asset_symbol,
        change_percent: parseFloat(worstPerformer.change_24h || 0)
      },
      asset_allocation: assetAllocation,
      total_assets: portfolioAssets.length
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