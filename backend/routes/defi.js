const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { DeFiPosition, YieldFarm, Reward } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// GET /api/defi/portfolio
router.get('/portfolio', authenticateToken, async (req, res) => {
  try {
    // Get all active DeFi positions for the user
    const positions = await DeFiPosition.findAll({
      where: {
        user_id: req.user.id,
        status: 'active'
      },
      attributes: [
        'position_id',
        'protocol',
        'position_type',
        'asset_symbol',
        'asset_amount',
        'value_usd',
        'apy',
        'rewards_earned',
        'status',
        'lock_period_days',
        'start_date',
        'end_date',
        'health_factor',
        'liquidation_price',
        'network',
        'metadata'
      ]
    });

    // Calculate totals
    const totalValueLocked = positions.reduce((sum, pos) => sum + parseFloat(pos.value_usd || 0), 0);
    const totalApy = positions.length > 0 ?
      positions.reduce((sum, pos) => sum + (parseFloat(pos.apy || 0) * parseFloat(pos.value_usd || 0)), 0) / totalValueLocked : 0;

    // Format positions for response
    const formattedPositions = positions.map(pos => ({
      position_id: pos.position_id,
      protocol: pos.protocol,
      type: pos.position_type,
      asset: pos.asset_symbol,
      amount: pos.asset_amount,
      value_usd: parseFloat(pos.value_usd || 0),
      apy: parseFloat(pos.apy || 0),
      rewards_earned: parseFloat(pos.rewards_earned || 0),
      status: pos.status,
      lock_period: pos.lock_period_days,
      start_date: pos.start_date,
      end_date: pos.end_date,
      health_factor: pos.health_factor ? parseFloat(pos.health_factor) : null,
      liquidation_price: pos.liquidation_price ? parseFloat(pos.liquidation_price) : null,
      network: pos.network
    }));

    res.json({
      total_value_locked: totalValueLocked,
      total_apy: totalApy,
      active_positions: positions.length,
      positions: formattedPositions
    });
  } catch (error) {
    console.error('DeFi portfolio error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch DeFi portfolio'
      }
    });
  }
});

// GET /api/defi/opportunities
router.get('/opportunities', authenticateToken, async (req, res) => {
  try {
    const { protocol, type, asset, min_apy, max_risk } = req.query;

    // Build where clause
    const whereClause = {
      is_active: true
    };

    if (protocol) whereClause.protocol = protocol;
    if (type) whereClause.farm_type = type;
    if (asset) whereClause.asset_symbol = asset;
    if (min_apy) whereClause.apy = { [Op.gte]: parseFloat(min_apy) };
    if (max_risk) whereClause.risk_level = { [Op.lte]: parseInt(max_risk) };

    // Get yield farming opportunities
    const opportunities = await YieldFarm.findAll({
      where: whereClause,
      attributes: [
        'farm_id',
        'protocol',
        'farm_type',
        'title',
        'description',
        'asset_symbol',
        'asset_name',
        'apy',
        'tvl_usd',
        'risk_level',
        'minimum_deposit',
        'lock_period_days',
        'reward_tokens',
        'tags',
        'network',
        'is_active',
        'start_date',
        'end_date'
      ],
      order: [['apy', 'DESC']]
    });

    // Format opportunities for response
    const formattedOpportunities = opportunities.map(opp => ({
      id: opp.farm_id,
      protocol: opp.protocol,
      type: opp.farm_type,
      title: opp.title,
      description: opp.description,
      asset: opp.asset_symbol,
      apy: parseFloat(opp.apy || 0),
      tvl: parseFloat(opp.tvl_usd || 0),
      risk_level: opp.risk_level,
      minimum_deposit: parseFloat(opp.minimum_deposit || 0),
      lock_period_days: opp.lock_period_days,
      rewards: opp.reward_tokens || [],
      tags: opp.tags || [],
      network: opp.network,
      start_date: opp.start_date,
      end_date: opp.end_date
    }));

    res.json({
      opportunities: formattedOpportunities,
      total_count: opportunities.length
    });
  } catch (error) {
    console.error('DeFi opportunities error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch DeFi opportunities'
      }
    });
  }
});

// POST /api/defi/lend
router.post('/lend', authenticateToken, [
  body('protocol').isString().notEmpty().withMessage('Protocol is required'),
  body('asset').isString().notEmpty().withMessage('Asset symbol is required'),
  body('amount').isFloat({ min: 0.00000001 }).withMessage('Amount must be greater than 0'),
  body('network').optional().isIn(['ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet']).withMessage('Invalid network')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { protocol, asset, amount, network = 'ethereum' } = req.body;

    // Generate position ID
    const positionId = `lend_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Get estimated APY from yield farm data (simplified)
    const yieldFarm = await YieldFarm.findOne({
      where: {
        protocol: protocol,
        asset_symbol: asset,
        farm_type: 'lending',
        is_active: true
      }
    });

    const estimatedApy = yieldFarm ? parseFloat(yieldFarm.apy || 0) : 4.2; // Default APY

    // Create DeFi position record
    const position = await DeFiPosition.create({
      position_id: positionId,
      user_id: req.user.id,
      protocol: protocol,
      position_type: 'lending',
      asset_symbol: asset,
      asset_amount: parseFloat(amount),
      value_usd: 0, // Would be calculated based on current price
      apy: estimatedApy,
      status: 'pending',
      network: network,
      start_date: new Date(),
      metadata: {
        initiated_at: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      }
    });

    // TODO: Integrate with actual DeFi protocol (Vesu, etc.)
    // This would involve:
    // 1. Calling the protocol's smart contract
    // 2. Submitting the lending transaction
    // 3. Monitoring for confirmation

    // Mock transaction hash for now
    const mockTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // Update position with transaction hash
    await position.update({
      tx_hash: mockTxHash,
      status: 'submitted'
    });

    res.json({
      position_id: position.position_id,
      transaction_hash: position.tx_hash,
      estimated_apy: position.apy,
      status: position.status,
      network: position.network,
      amount: position.asset_amount.toString(),
      asset: position.asset_symbol
    });
  } catch (error) {
    console.error('DeFi lend error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create lending position'
      }
    });
  }
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
router.get('/rewards', authenticateToken, async (req, res) => {
  try {
    // Get all pending rewards for the user
    const rewards = await Reward.findAll({
      where: {
        user_id: req.user.id,
        status: 'pending'
      },
      attributes: [
        'reward_id',
        'protocol',
        'asset_symbol',
        'amount',
        'value_usd',
        'claimable_at',
        'status',
        'created_at',
        'position_id',
        'metadata'
      ],
      order: [['claimable_at', 'ASC']]
    });

    // Calculate total pending rewards
    const totalPendingRewards = rewards.reduce((sum, reward) => {
      return sum + parseFloat(reward.value_usd || 0);
    }, 0);

    // Format rewards for response
    const formattedRewards = rewards.map(reward => ({
      reward_id: reward.reward_id,
      protocol: reward.protocol,
      asset: reward.asset_symbol,
      amount: reward.amount,
      value_usd: parseFloat(reward.value_usd || 0),
      claimable_at: reward.claimable_at,
      status: reward.status,
      position_id: reward.position_id
    }));

    res.json({
      total_pending_rewards: totalPendingRewards,
      rewards: formattedRewards,
      total_count: rewards.length
    });
  } catch (error) {
    console.error('DeFi rewards error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch rewards'
      }
    });
  }
});

// POST /api/defi/claim-rewards
router.post('/claim-rewards', authenticateToken, [
  body('reward_ids').isArray().withMessage('Reward IDs must be an array'),
  body('reward_ids.*').isString().notEmpty().withMessage('Invalid reward ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { reward_ids } = req.body;

    // Find and validate rewards
    const rewards = await Reward.findAll({
      where: {
        reward_id: { [Op.in]: reward_ids },
        user_id: req.user.id,
        status: 'pending'
      }
    });

    if (rewards.length === 0) {
      return res.status(404).json({
        error: {
          code: 'REWARDS_NOT_FOUND',
          message: 'No valid rewards found to claim'
        }
      });
    }

    // Calculate total amount to claim
    const totalAmount = rewards.reduce((sum, reward) => {
      return sum + parseFloat(reward.amount || 0);
    }, 0);

    const totalValueUsd = rewards.reduce((sum, reward) => {
      return sum + parseFloat(reward.value_usd || 0);
    }, 0);

    // TODO: Integrate with actual reward claiming logic
    // This would involve calling the protocol's claim function

    // Mock transaction hash for now
    const mockTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // Update reward statuses
    await Reward.update(
      {
        status: 'claimed',
        claimed_at: new Date(),
        tx_hash: mockTxHash
      },
      {
        where: {
          reward_id: { [Op.in]: reward_ids },
          user_id: req.user.id
        }
      }
    );

    res.json({
      transaction_hash: mockTxHash,
      claimed_amount: totalAmount.toString(),
      claimed_value_usd: totalValueUsd,
      rewards_claimed: rewards.length,
      status: 'pending',
      reward_ids: reward_ids
    });
  } catch (error) {
    console.error('Claim rewards error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to claim rewards'
      }
    });
  }
});

module.exports = router;