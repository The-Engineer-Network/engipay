/**
 * Staking Routes
 * 
 * API endpoints for Trove staking operations
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken: auth } = require('../middleware/auth');
const troveStakingService = require('../services/TroveStakingService');
const StakingPosition = require('../models/StakingPosition');
const StakingTransaction = require('../models/StakingTransaction');

/**
 * @route   POST /api/staking/stake
 * @desc    Stake tokens in a staking contract
 * @access  Private
 */
router.post(
  '/stake',
  auth,
  [
    body('stakingContractAddress')
      .isString()
      .matches(/^0x[0-9a-fA-F]{1,64}$/)
      .withMessage('Invalid staking contract address'),
    body('stakingToken')
      .isString()
      .withMessage('Staking token is required'),
    body('rewardToken')
      .isString()
      .withMessage('Reward token is required'),
    body('amount')
      .isNumeric()
      .custom(value => parseFloat(value) > 0)
      .withMessage('Amount must be greater than 0'),
    body('walletAddress')
      .isString()
      .matches(/^0x[0-9a-fA-F]{1,64}$/)
      .withMessage('Invalid wallet address'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { stakingContractAddress, stakingToken, rewardToken, amount, walletAddress } = req.body;
      const userId = req.user.id;

      const result = await troveStakingService.stake(
        userId,
        stakingContractAddress,
        stakingToken,
        rewardToken,
        amount,
        walletAddress
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error staking tokens:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/staking/position/:positionId/withdraw
 * @desc    Withdraw staked tokens
 * @access  Private
 */
router.post(
  '/position/:positionId/withdraw',
  auth,
  [
    param('positionId').isUUID().withMessage('Invalid position ID'),
    body('amount')
      .isNumeric()
      .custom(value => parseFloat(value) > 0)
      .withMessage('Amount must be greater than 0'),
    body('walletAddress')
      .isString()
      .matches(/^0x[0-9a-fA-F]{1,64}$/)
      .withMessage('Invalid wallet address'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { positionId } = req.params;
      const { amount, walletAddress } = req.body;
      const userId = req.user.id;

      const result = await troveStakingService.withdraw(
        userId,
        positionId,
        amount,
        walletAddress
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error withdrawing tokens:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/staking/position/:positionId/claim
 * @desc    Claim accumulated rewards
 * @access  Private
 */
router.post(
  '/position/:positionId/claim',
  auth,
  [
    param('positionId').isUUID().withMessage('Invalid position ID'),
    body('walletAddress')
      .isString()
      .matches(/^0x[0-9a-fA-F]{1,64}$/)
      .withMessage('Invalid wallet address'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { positionId } = req.params;
      const { walletAddress } = req.body;
      const userId = req.user.id;

      const result = await troveStakingService.claimRewards(
        userId,
        positionId,
        walletAddress
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error claiming rewards:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/staking/position/:positionId
 * @desc    Get staking position details
 * @access  Private
 */
router.get(
  '/position/:positionId',
  auth,
  [param('positionId').isUUID().withMessage('Invalid position ID')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { positionId } = req.params;

      const position = await troveStakingService.getPosition(positionId);

      res.json({
        success: true,
        data: position,
      });
    } catch (error) {
      console.error('Error getting position:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/staking/positions
 * @desc    Get all user staking positions
 * @access  Private
 */
router.get('/positions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    const positions = await troveStakingService.getUserPositions(userId, status);

    res.json({
      success: true,
      data: positions,
    });
  } catch (error) {
    console.error('Error getting positions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/staking/analytics
 * @desc    Get user staking analytics
 * @access  Private
 */
router.get('/analytics', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const analytics = await troveStakingService.getUserStakingAnalytics(userId);

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    console.error('Error getting staking analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/staking/position/:positionId/update
 * @desc    Update position rewards
 * @access  Private
 */
router.post(
  '/position/:positionId/update',
  auth,
  [param('positionId').isUUID().withMessage('Invalid position ID')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { positionId } = req.params;

      const result = await troveStakingService.updatePositionRewards(positionId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error updating position:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/staking/transactions
 * @desc    Get user staking transactions
 * @access  Private
 */
router.get('/transactions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, status, limit = 50, offset = 0 } = req.query;

    const where = { user_id: userId };
    if (type) where.type = type;
    if (status) where.status = status;

    const transactions = await StakingTransaction.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
    });

    const total = await StakingTransaction.count({ where });

    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
        },
      },
    });
  } catch (error) {
    console.error('Error getting transactions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
