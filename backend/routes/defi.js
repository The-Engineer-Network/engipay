const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Mock DeFi data
const mockDefiPortfolio = {
  total_value_locked: 4200.00,
  total_apy: 8.6,
  active_positions: 3,
  positions: [
    {
      protocol: 'Vesu',
      type: 'lending',
      asset: 'ETH',
      amount: '0.85',
      value_usd: 1680.00,
      apy: 4.2,
      rewards_earned: 7.06,
      status: 'active',
      lock_period: null,
      start_date: '2024-01-01T00:00:00Z'
    }
  ]
};

// GET /api/defi/portfolio
router.get('/portfolio', authenticateToken, (req, res) => {
  res.json(mockDefiPortfolio);
});

// GET /api/defi/opportunities
router.get('/opportunities', authenticateToken, (req, res) => {
  const mockOpportunities = [
    {
      id: 'opp_123',
      protocol: 'Vesu',
      type: 'lending',
      title: 'ETH Lending Pool',
      description: 'Earn interest by lending ETH',
      asset: 'ETH',
      apy: 4.2,
      tvl: 1000000.00,
      risk_level: 1,
      minimum_deposit: 0.01,
      lock_period_days: 0,
      rewards: ['ETH'],
      tags: ['low-risk', 'stable']
    }
  ];
  res.json({ opportunities: mockOpportunities });
});

// POST /api/defi/lend
router.post('/lend', authenticateToken, (req, res) => {
  const { protocol, asset, amount, network } = req.body;
  res.json({
    position_id: `pos_${Date.now()}`,
    transaction_hash: `0x${Math.random().toString(16).substring(2)}`,
    estimated_apy: 4.2,
    status: 'pending'
  });
});

// POST /api/defi/borrow
router.post('/borrow', authenticateToken, (req, res) => {
  const { protocol, collateral_asset, collateral_amount, borrow_asset, borrow_amount, network } = req.body;
  res.json({
    position_id: `pos_${Date.now()}`,
    transaction_hash: `0x${Math.random().toString(16).substring(2)}`,
    health_factor: 2.1,
    liquidation_price: 1800.00,
    status: 'pending'
  });
});

// POST /api/defi/stake
router.post('/stake', authenticateToken, (req, res) => {
  const { protocol, asset, amount, pool_id, lock_period_days } = req.body;
  res.json({
    position_id: `pos_${Date.now()}`,
    transaction_hash: `0x${Math.random().toString(16).substring(2)}`,
    status: 'pending'
  });
});

// GET /api/defi/rewards
router.get('/rewards', authenticateToken, (req, res) => {
  res.json({
    total_pending_rewards: 127.00,
    rewards: [
      {
        protocol: 'Trove',
        asset: 'STRK',
        amount: '25.50',
        value_usd: 25.50,
        claimable_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      }
    ]
  });
});

// POST /api/defi/claim-rewards
router.post('/claim-rewards', authenticateToken, (req, res) => {
  const { protocol, asset } = req.body;
  res.json({
    transaction_hash: `0x${Math.random().toString(16).substring(2)}`,
    claimed_amount: '25.50',
    status: 'pending'
  });
});

module.exports = router;