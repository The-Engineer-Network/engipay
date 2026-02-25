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

    // Integrate with VesuService for real lending
    const VesuService = require('../services/VesuService');
    const vesuService = new VesuService();
    
    try {
      // Execute supply operation through VesuService
      const supplyResult = await vesuService.supply(
        req.user.walletAddress,
        asset,
        amount,
        protocol
      );

      // Update position with real transaction hash
      await position.update({
        tx_hash: supplyResult.transactionHash,
        status: 'submitted',
        metadata: {
          ...position.metadata,
          vesu_position_id: supplyResult.positionId,
          vtoken_amount: supplyResult.vTokenAmount
        }
      });
    } catch (vesuError) {
      // If VesuService fails, update position status
      await position.update({
        status: 'failed',
        metadata: {
          ...position.metadata,
          error: vesuError.message
        }
      });
      throw vesuError;
    }

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
router.post('/borrow', authenticateToken, [
  body('protocol').isString().notEmpty().withMessage('Protocol is required'),
  body('collateral_asset').isString().notEmpty().withMessage('Collateral asset is required'),
  body('collateral_amount').isFloat({ min: 0.00000001 }).withMessage('Collateral amount must be greater than 0'),
  body('borrow_asset').isString().notEmpty().withMessage('Borrow asset is required'),
  body('borrow_amount').isFloat({ min: 0.00000001 }).withMessage('Borrow amount must be greater than 0'),
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

    const { protocol, collateral_asset, collateral_amount, borrow_asset, borrow_amount, network = 'starknet' } = req.body;

    // Integrate with VesuService for real borrowing
    const VesuService = require('../services/VesuService');
    const vesuService = new VesuService();

    // Execute borrow operation
    const borrowResult = await vesuService.borrow(
      req.user.walletAddress,
      collateral_asset,
      collateral_amount,
      borrow_asset,
      borrow_amount
    );

    // Create DeFi position record
    const positionId = `borrow_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const position = await DeFiPosition.create({
      position_id: positionId,
      user_id: req.user.id,
      protocol: protocol,
      position_type: 'borrowing',
      asset_symbol: borrow_asset,
      asset_amount: parseFloat(borrow_amount),
      value_usd: 0, // Would be calculated based on current price
      status: 'submitted',
      network: network,
      start_date: new Date(),
      tx_hash: borrowResult.transactionHash,
      health_factor: borrowResult.healthFactor,
      liquidation_price: borrowResult.liquidationPrice,
      metadata: {
        collateral_asset: collateral_asset,
        collateral_amount: collateral_amount,
        vesu_position_id: borrowResult.positionId,
        initiated_at: new Date().toISOString()
      }
    });

    res.json({
      position_id: position.position_id,
      transaction_hash: position.tx_hash,
      health_factor: borrowResult.healthFactor,
      liquidation_price: borrowResult.liquidationPrice,
      status: position.status,
      network: position.network
    });
  } catch (error) {
    console.error('DeFi borrow error:', error);
    res.status(500).json({
      error: {
        code: 'BORROW_ERROR',
        message: error.message || 'Failed to create borrow position'
      }
    });
  }
});

// POST /api/defi/stake
router.post('/stake', authenticateToken, [
  body('protocol').isString().notEmpty().withMessage('Protocol is required'),
  body('asset').isString().notEmpty().withMessage('Asset is required'),
  body('amount').isFloat({ min: 0.00000001 }).withMessage('Amount must be greater than 0'),
  body('pool_id').optional().isString().withMessage('Pool ID must be a string'),
  body('lock_period_days').optional().isInt({ min: 0 }).withMessage('Lock period must be a positive integer')
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

    const { protocol, asset, amount, pool_id, lock_period_days = 0 } = req.body;

    // Integrate with TroveStakingService for real staking
    const TroveStakingService = require('../services/TroveStakingService');
    const stakingService = new TroveStakingService();

    // Execute stake operation
    const stakeResult = await stakingService.stake(
      req.user.id,
      pool_id || process.env.DEFAULT_STAKING_CONTRACT,
      asset,
      asset, // reward token (same as staking token for now)
      amount,
      req.user.walletAddress
    );

    res.json({
      position_id: stakeResult.position_id,
      transaction_hash: stakeResult.transaction_hash,
      status: stakeResult.status,
      apy: stakeResult.apy,
      lock_period_days: lock_period_days
    });
  } catch (error) {
    console.error('DeFi stake error:', error);
    res.status(500).json({
      error: {
        code: 'STAKE_ERROR',
        message: error.message || 'Failed to create stake position'
      }
    });
  }
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

    // Integrate with TroveStakingService for real reward claiming
    const TroveStakingService = require('../services/TroveStakingService');
    const stakingService = new TroveStakingService();

    try {
      // Group rewards by position for batch claiming
      const rewardsByPosition = {};
      rewards.forEach(reward => {
        if (!rewardsByPosition[reward.position_id]) {
          rewardsByPosition[reward.position_id] = [];
        }
        rewardsByPosition[reward.position_id].push(reward);
      });

      // Claim rewards for each position
      const claimResults = [];
      for (const [positionId, positionRewards] of Object.entries(rewardsByPosition)) {
        const claimResult = await stakingService.claimRewards(
          req.user.id,
          positionId,
          req.user.walletAddress
        );
        claimResults.push(claimResult);
      }

      // Use the first transaction hash (or combine them)
      const transactionHash = claimResults[0]?.transaction_hash || `0x${Date.now().toString(16)}`;

      // Update reward statuses
      await Reward.update(
        {
          status: 'claimed',
          claimed_at: new Date(),
          tx_hash: transactionHash
        },
        {
          where: {
            reward_id: { [Op.in]: reward_ids },
            user_id: req.user.id
          }
        }
      );

      res.json({
        transaction_hash: transactionHash,
        claimed_amount: totalAmount.toString(),
        claimed_value_usd: totalValueUsd,
        rewards_claimed: rewards.length,
        status: 'submitted',
        reward_ids: reward_ids,
        claim_results: claimResults
      });
    } catch (claimError) {
      console.error('Reward claim error:', claimError);
      res.status(500).json({
        error: {
          code: 'CLAIM_ERROR',
          message: claimError.message || 'Failed to claim rewards'
        }
      });
    }
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


// GET /api/defi/farming-pools
router.get('/farming-pools', async (req, res) => {
  try {
    // Get active yield farming opportunities from database
    const farmingPools = await YieldFarm.findAll({
      where: {
        is_active: true,
        farm_type: 'liquidity_mining'
      },
      attributes: [
        'farm_id',
        'protocol',
        'title',
        'asset_symbol',
        'apy',
        'tvl_usd',
        'risk_level',
        'minimum_deposit',
        'lock_period_days',
        'reward_tokens',
        'tags'
      ],
      order: [['apy', 'DESC']],
      limit: 20
    });

    // Get staking pools
    const stakingPools = await YieldFarm.findAll({
      where: {
        is_active: true,
        farm_type: 'staking'
      },
      attributes: [
        'farm_id',
        'protocol',
        'title',
        'asset_symbol',
        'apy',
        'tvl_usd',
        'risk_level',
        'minimum_deposit',
        'lock_period_days',
        'reward_tokens',
        'tags'
      ],
      order: [['apy', 'DESC']],
      limit: 20
    });

    // Format farming pools
    const formattedFarmingPools = farmingPools.map(pool => ({
      protocol: pool.protocol,
      pair: pool.title || `${pool.asset_symbol}/STRK`,
      apy: pool.apy ? `${parseFloat(pool.apy).toFixed(2)}%` : '0%',
      tvl: pool.tvl_usd ? `$${parseFloat(pool.tvl_usd).toLocaleString()}` : '$0',
      rewards: pool.reward_tokens || ['STRK'],
      multiplier: '1x',
      lockPeriod: pool.lock_period_days ? `${pool.lock_period_days} days` : 'Flexible',
      risk: pool.risk_level === 1 ? 'Low' : pool.risk_level === 2 ? 'Medium' : 'High'
    }));

    // Format staking pools
    const formattedStakingPools = stakingPools.map(pool => ({
      protocol: pool.protocol,
      asset: pool.asset_symbol,
      apy: pool.apy ? `${parseFloat(pool.apy).toFixed(2)}%` : '0%',
      tvl: pool.tvl_usd ? `$${parseFloat(pool.tvl_usd).toLocaleString()}` : '$0',
      rewards: pool.reward_tokens || ['STRK'],
      lockPeriod: pool.lock_period_days ? `${pool.lock_period_days} days` : 'Flexible',
      risk: pool.risk_level === 1 ? 'Low' : pool.risk_level === 2 ? 'Medium' : 'High'
    }));

    res.json({
      success: true,
      farmingPools: formattedFarmingPools,
      stakingPools: formattedStakingPools
    });
  } catch (error) {
    console.error('Farming pools error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch farming pools'
      }
    });
  }
});

// GET /api/defi/user-farms/:walletAddress
router.get('/user-farms/:walletAddress', authenticateToken, async (req, res) => {
  try {
    const { walletAddress } = req.params;

    // Get user's active farming/staking positions
    const positions = await DeFiPosition.findAll({
      where: {
        user_id: req.user.id,
        status: 'active',
        position_type: { [Op.in]: ['staking', 'liquidity_mining'] }
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
        'start_date',
        'end_date',
        'metadata'
      ]
    });

    // Format user farms
    const formattedFarms = positions.map(pos => {
      const timeLeft = pos.end_date ? 
        Math.max(0, Math.floor((new Date(pos.end_date) - new Date()) / (1000 * 60 * 60 * 24))) : 
        null;

      return {
        protocol: pos.protocol,
        pair: pos.metadata?.pair || pos.asset_symbol,
        asset: pos.asset_symbol,
        staked: pos.asset_amount,
        value: `$${parseFloat(pos.value_usd || 0).toFixed(2)}`,
        rewards: pos.rewards_earned || '0',
        apy: `${parseFloat(pos.apy || 0).toFixed(2)}%`,
        timeLeft: timeLeft !== null ? `${timeLeft} days` : 'Flexible'
      };
    });

    res.json({
      success: true,
      farms: formattedFarms
    });
  } catch (error) {
    console.error('User farms error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch user farms'
      }
    });
  }
});
