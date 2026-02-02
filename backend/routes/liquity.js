/**
 * Liquity Protocol Routes
 * 
 * API endpoints for Liquity Trove operations and monitoring
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const { authenticateToken: auth } = require('../middleware/auth');
const liquityService = require('../services/LiquityService');
const liquityMonitor = require('../services/LiquityMonitor');
const LiquityTrove = require('../models/LiquityTrove');
const LiquityTransaction = require('../models/LiquityTransaction');
const LiquityStabilityDeposit = require('../models/LiquityStabilityDeposit');

/**
 * @route   GET /api/liquity/status
 * @desc    Get Liquity service status
 * @access  Public
 */
router.get('/status', async (req, res) => {
  try {
    const ethPrice = await liquityService.getEthPrice();
    const tcr = await liquityService.getTotalCollateralRatio();
    const monitorStatus = liquityMonitor.getStatus();

    res.json({
      success: true,
      data: {
        initialized: liquityService.initialized,
        ethPrice,
        totalCollateralRatio: tcr,
        monitoring: monitorStatus,
      },
    });
  } catch (error) {
    console.error('Error getting Liquity status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/liquity/price
 * @desc    Get current ETH price from Liquity oracle
 * @access  Public
 */
router.get('/price', async (req, res) => {
  try {
    const price = await liquityService.getEthPrice();

    res.json({
      success: true,
      data: {
        ethPrice: price,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Error getting ETH price:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/liquity/trove/open
 * @desc    Open a new Trove
 * @access  Private
 */
router.post(
  '/trove/open',
  auth,
  [
    body('depositCollateral')
      .isFloat({ min: 0.01 })
      .withMessage('Deposit collateral must be at least 0.01 ETH'),
    body('borrowLUSD')
      .isFloat({ min: 2000 })
      .withMessage('Minimum borrow amount is 2000 LUSD'),
    body('maxBorrowingRate')
      .optional()
      .isFloat({ min: 0.005, max: 0.05 })
      .withMessage('Max borrowing rate must be between 0.5% and 5%'),
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

      const { depositCollateral, borrowLUSD, maxBorrowingRate } = req.body;
      const userId = req.user.id;

      // Check if user already has an active Trove
      const existingTrove = await LiquityTrove.findOne({
        where: { userId, status: 'active' },
      });

      if (existingTrove) {
        return res.status(400).json({
          success: false,
          error: 'User already has an active Trove',
        });
      }

      const result = await liquityService.openTrove(
        userId,
        depositCollateral,
        borrowLUSD,
        maxBorrowingRate
      );

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error opening Trove:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/liquity/trove/:troveId/close
 * @desc    Close a Trove
 * @access  Private
 */
router.post(
  '/trove/:troveId/close',
  auth,
  [param('troveId').isUUID().withMessage('Invalid Trove ID')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { troveId } = req.params;
      const userId = req.user.id;

      const result = await liquityService.closeTrove(userId, troveId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error closing Trove:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/liquity/trove/:troveId/adjust
 * @desc    Adjust Trove (add/remove collateral, borrow/repay)
 * @access  Private
 */
router.post(
  '/trove/:troveId/adjust',
  auth,
  [
    param('troveId').isUUID().withMessage('Invalid Trove ID'),
    body('depositCollateral')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Deposit collateral must be positive'),
    body('withdrawCollateral')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Withdraw collateral must be positive'),
    body('borrowLUSD')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Borrow amount must be positive'),
    body('repayLUSD')
      .optional()
      .isFloat({ min: 0 })
      .withMessage('Repay amount must be positive'),
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

      const { troveId } = req.params;
      const userId = req.user.id;
      const params = req.body;

      const result = await liquityService.adjustTrove(userId, troveId, params);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error adjusting Trove:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/liquity/trove/:troveId
 * @desc    Get Trove details
 * @access  Private
 */
router.get(
  '/trove/:troveId',
  auth,
  [param('troveId').isUUID().withMessage('Invalid Trove ID')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { troveId } = req.params;
      const userId = req.user.id;

      const trove = await LiquityTrove.findOne({
        where: { id: troveId, userId },
      });

      if (!trove) {
        return res.status(404).json({
          success: false,
          error: 'Trove not found',
        });
      }

      // Get current state from blockchain
      const currentState = await liquityService.getTrove(trove.ownerAddress);

      res.json({
        success: true,
        data: {
          trove: trove.toJSON(),
          currentState,
        },
      });
    } catch (error) {
      console.error('Error getting Trove:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/liquity/troves
 * @desc    Get all user Troves
 * @access  Private
 */
router.get('/troves', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    const where = { userId };
    if (status) {
      where.status = status;
    }

    const troves = await LiquityTrove.findAll({
      where,
      order: [['createdAt', 'DESC']],
    });

    res.json({
      success: true,
      data: troves,
    });
  } catch (error) {
    console.error('Error getting Troves:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route   POST /api/liquity/trove/:troveId/check
 * @desc    Manually check Trove health
 * @access  Private
 */
router.post(
  '/trove/:troveId/check',
  auth,
  [param('troveId').isUUID().withMessage('Invalid Trove ID')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { troveId } = req.params;

      const result = await liquityMonitor.checkTroveById(troveId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error checking Trove:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/liquity/stability/deposit
 * @desc    Deposit LUSD to Stability Pool
 * @access  Private
 */
router.post(
  '/stability/deposit',
  auth,
  [
    body('amount')
      .isFloat({ min: 1 })
      .withMessage('Deposit amount must be at least 1 LUSD'),
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

      const { amount } = req.body;
      const userId = req.user.id;

      const result = await liquityService.depositToStabilityPool(userId, amount);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error depositing to Stability Pool:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   POST /api/liquity/stability/withdraw
 * @desc    Withdraw LUSD from Stability Pool
 * @access  Private
 */
router.post(
  '/stability/withdraw',
  auth,
  [
    body('amount')
      .isFloat({ min: 0 })
      .withMessage('Withdraw amount must be positive'),
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

      const { amount } = req.body;
      const userId = req.user.id;

      const result = await liquityService.withdrawFromStabilityPool(userId, amount);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error('Error withdrawing from Stability Pool:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

/**
 * @route   GET /api/liquity/stability/deposit
 * @desc    Get Stability Pool deposit info
 * @access  Private
 */
router.get('/stability/deposit', auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const deposit = await LiquityStabilityDeposit.findOne({
      where: { userId, status: 'active' },
    });

    if (!deposit) {
      return res.json({
        success: true,
        data: null,
      });
    }

    // Get current state from blockchain
    const currentState = await liquityService.getStabilityDeposit(deposit.depositorAddress);

    res.json({
      success: true,
      data: {
        deposit: deposit.toJSON(),
        currentState,
      },
    });
  } catch (error) {
    console.error('Error getting Stability Pool deposit:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * @route   GET /api/liquity/transactions
 * @desc    Get user Liquity transactions
 * @access  Private
 */
router.get('/transactions', auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { type, status, limit = 50, offset = 0 } = req.query;

    const where = { userId };
    if (type) where.type = type;
    if (status) where.status = status;

    const transactions = await LiquityTransaction.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['createdAt', 'DESC']],
    });

    const total = await LiquityTransaction.count({ where });

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

/**
 * @route   GET /api/liquity/tcr
 * @desc    Get Total Collateral Ratio of the system
 * @access  Public
 */
router.get('/tcr', async (req, res) => {
  try {
    const tcr = await liquityService.getTotalCollateralRatio();

    res.json({
      success: true,
      data: tcr,
    });
  } catch (error) {
    console.error('Error getting TCR:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
