/**
 * Vesu V2 Lending Protocol Integration - API Routes
 * 
 * This module provides REST API endpoints for interacting with the Vesu V2 lending protocol.
 * 
 * Implemented Endpoints:
 * - POST /api/vesu/supply - Supply assets to a lending pool
 * - GET /api/vesu/supply/estimate - Estimate vTokens for a supply amount
 * - POST /api/vesu/borrow - Borrow assets against collateral
 * - GET /api/vesu/borrow/max - Calculate maximum borrowable amount
 * 
 * All endpoints include:
 * - Authentication via JWT (where required)
 * - Input validation using express-validator
 * - Rate limiting (100 requests per 15 minutes for supply, 50 for borrow)
 * - Comprehensive error handling with appropriate HTTP status codes
 * 
 * @module routes/vesu
 */

const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { supplyRateLimit, borrowRateLimit, repayRateLimit, withdrawRateLimit, positionRateLimit, poolRateLimit, liquidationRateLimit } = require('../middleware/rateLimit');
const { VesuService, VesuError } = require('../services/VesuService');
const LiquidationEngine = require('../services/LiquidationEngine');
const StarknetContractManager = require('../services/StarknetContractManager');
const { PragmaOracleService } = require('../services/PragmaOracleService');
const TransactionManager = require('../services/TransactionManager');
const VesuPool = require('../models/VesuPool');
const VesuPosition = require('../models/VesuPosition');
const VesuLiquidation = require('../models/VesuLiquidation');

const router = express.Router();


let vesuService;
let liquidationEngine;

try {
  // Initialize Starknet dependencies
  const contractManager = new StarknetContractManager();
  const oracleService = new PragmaOracleService();
  const transactionManager = new TransactionManager(contractManager.provider);

  // Initialize VesuService with dependencies
  vesuService = new VesuService(contractManager, oracleService, transactionManager);

  // Initialize LiquidationEngine with VesuService
  liquidationEngine = new LiquidationEngine(vesuService, transactionManager);

  console.log(' Vesu services initialized successfully');
} catch (error) {
  console.error(' Failed to initialize Vesu services:', error);
  // Services will be null, routes will handle gracefully
}

/**
 * Async handler wrapper to catch errors and pass to Express error handler
 * @param {Function} fn - Async route handler function
 * @returns {Function} Wrapped handler with error catching
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Handle VesuError and convert to appropriate HTTP response
 * @param {Error} error - Error object
 * @param {Object} res - Express response object
 */
const handleVesuError = (error, res) => {
  if (error instanceof VesuError) {
    // Map error codes to HTTP status codes
    const statusCodeMap = {
      // Validation errors (400)
      INVALID_AMOUNT: 400,
      INVALID_ADDRESS: 400,
      INSUFFICIENT_BALANCE: 400,
      INVALID_ASSET: 400,
      INVALID_POOL: 400,
      
      // Business logic errors (422)
      LTV_EXCEEDED: 422,
      INSUFFICIENT_LIQUIDITY: 422,
      POSITION_UNDERCOLLATERALIZED: 422,
      HEALTH_FACTOR_TOO_LOW: 422,
      POOL_NOT_ACTIVE: 422,
      
      // External service errors (502/503)
      STARKNET_RPC_ERROR: 502,
      ORACLE_UNAVAILABLE: 503,
      TRANSACTION_FAILED: 502,
      
      // System errors (500)
      DATABASE_ERROR: 500,
      INTERNAL_ERROR: 500,
    };

    const statusCode = statusCodeMap[error.code] || 500;

    return res.status(statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details || {}
      }
    });
  }

  // Generic error handling
  console.error('Unhandled error in Vesu route:', error);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: {}
    }
  });
};

/**
 * Validate express-validator results
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @returns {boolean} True if validation passed, false otherwise
 */
const validateRequest = (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        details: errors.array()
      }
    });
    return false;
  }
  return true;
};

/**
 * Check if services are initialized
 * @param {Object} res - Express response object
 * @returns {boolean} True if services are available, false otherwise
 */
const checkServicesAvailable = (res) => {
  if (!vesuService || !liquidationEngine) {
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Vesu services are not available. Please try again later.',
        details: {}
      }
    });
    return false;
  }
  return true;
};


// Health check endpoint for Vesu integration
router.get('/health', asyncHandler(async (req, res) => {
  const isHealthy = vesuService && liquidationEngine;
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'OK' : 'UNAVAILABLE',
    services: {
      vesuService: !!vesuService,
      liquidationEngine: !!liquidationEngine
    },
    timestamp: new Date().toISOString()
  });
}));

// ============================================================================
// SUPPLY ENDPOINTS
// ============================================================================

/**
 * POST /api/vesu/supply
 * Supply assets to a lending pool
 * 
 */
router.post('/supply',
  supplyRateLimit, 
  authenticateToken, 
  [
    //  Add input validation middleware
    body('poolAddress').notEmpty().withMessage('poolAddress is required')
      .isString().withMessage('poolAddress must be a string'),
    body('asset').notEmpty().withMessage('asset is required')
      .isString().withMessage('asset must be a string'),
    body('amount').notEmpty().withMessage('amount is required')
      .isNumeric().withMessage('amount must be numeric'),
    body('walletAddress').notEmpty().withMessage('walletAddress is required')
      .isString().withMessage('walletAddress must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { poolAddress, asset, amount, walletAddress } = req.body;
    const userId = req.user.id; // From JWT authentication

    try {
      //  Call VesuService.supply()
      const result = await vesuService.supply(
        poolAddress,
        asset,
        amount,
        walletAddress,
        userId
      );

      //  Return 200 with success response
      res.status(200).json({
        success: true,
        transactionHash: result.transactionHash,
        vTokensReceived: result.vTokensReceived,
        position: result.position
      });
    } catch (error) {
      //  Handle errors with appropriate status codes
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/supply/estimate
 * Estimate vTokens to receive for a supply amount
 * 
 *  GET /api/vesu/supply/estimate - Estimate vTokens for supply amount
 */
router.get('/supply/estimate',
  supplyRateLimit, //  Add rate limiting
  [
    //  Add input validation for query params
    query('poolAddress').notEmpty().withMessage('poolAddress is required')
      .isString().withMessage('poolAddress must be a string'),
    query('asset').notEmpty().withMessage('asset is required')
      .isString().withMessage('asset must be a string'),
    query('amount').notEmpty().withMessage('amount is required')
      .isNumeric().withMessage('amount must be numeric'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { poolAddress, asset, amount } = req.query;

    try {
      //  Fetch exchange rate using StarknetContractManager.getVTokenExchangeRateForPool()
      const exchangeRate = await vesuService.contractManager.getVTokenExchangeRateForPool(
        poolAddress,
        asset
      );

      //  Calculate vTokens using VesuService.calculateVTokensToReceive()
      const estimatedVTokens = vesuService.calculateVTokensToReceive(
        amount,
        exchangeRate
      );

      //  Return 200 with estimation response
      res.status(200).json({
        asset,
        amount,
        estimatedVTokens: estimatedVTokens.toString(),
        exchangeRate
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

// ============================================================================
// BORROW ENDPOINTS
// ============================================================================

/**
 * POST /api/vesu/borrow
 * Borrow assets against collateral
 * 
 * POST /api/vesu/borrow - Borrow assets against collateral
 */
router.post('/borrow',
  borrowRateLimit, //  Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add input validation middleware
    body('poolAddress').notEmpty().withMessage('poolAddress is required')
      .isString().withMessage('poolAddress must be a string'),
    body('collateralAsset').notEmpty().withMessage('collateralAsset is required')
      .isString().withMessage('collateralAsset must be a string'),
    body('debtAsset').notEmpty().withMessage('debtAsset is required')
      .isString().withMessage('debtAsset must be a string'),
    body('borrowAmount').notEmpty().withMessage('borrowAmount is required')
      .isNumeric().withMessage('borrowAmount must be numeric'),
    body('walletAddress').notEmpty().withMessage('walletAddress is required')
      .isString().withMessage('walletAddress must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { poolAddress, collateralAsset, debtAsset, borrowAmount, walletAddress } = req.body;
    const userId = req.user.id; // From JWT authentication

    try {
      //  Call VesuService.borrow()
      const result = await vesuService.borrow(
        poolAddress,
        collateralAsset,
        debtAsset,
        borrowAmount,
        walletAddress,
        userId
      );

      //  Return 200 with success response
      res.status(200).json({
        success: true,
        transactionHash: result.transactionHash,
        borrowedAmount: result.borrowedAmount,
        position: result.position
      });
    } catch (error) {
      //  Handle LTV_EXCEEDED and HEALTH_FACTOR_TOO_LOW errors with 422 status
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/borrow/max
 * Calculate maximum borrowable amount for a position
 * 
 *  GET /api/vesu/borrow/max - Calculate maximum borrowable amount
 */
router.get('/borrow/max',
  borrowRateLimit, //Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add input validation for query params
    query('positionId').notEmpty().withMessage('positionId is required')
      .isString().withMessage('positionId must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { positionId } = req.query;

    try {
      //  Fetch position and call VesuService.getMaxBorrowable()
      const result = await vesuService.getMaxBorrowable(positionId);

      //  Return 200 with response
      res.status(200).json({
        positionId: result.positionId,
        maxBorrowable: result.maxBorrowable,
        currentDebt: result.currentDebt,
        availableLiquidity: result.availableLiquidity
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

// ============================================================================
// REPAY ENDPOINTS
// ============================================================================

/**
 * POST /api/vesu/repay
 * Repay borrowed assets
 * 
 *  POST /api/vesu/repay - Repay borrowed assets
 */
router.post('/repay',
  repayRateLimit, // Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add input validation (positionId, amount, walletAddress required)
    body('positionId').notEmpty().withMessage('positionId is required')
      .isString().withMessage('positionId must be a string'),
    body('amount').notEmpty().withMessage('amount is required')
      .isNumeric().withMessage('amount must be numeric'),
    body('walletAddress').notEmpty().withMessage('walletAddress is required')
      .isString().withMessage('walletAddress must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { positionId, amount, walletAddress } = req.body;

    try {
      //  Call VesuService.repay(positionId, amount, walletAddress)
      const result = await vesuService.repay(positionId, amount, walletAddress);

      //  Return 200 with { success, transactionHash, repaidAmount, remainingDebt, newHealthFactor, position }
      res.status(200).json({
        success: result.success,
        transactionHash: result.transactionHash,
        repaidAmount: result.repaidAmount,
        remainingDebt: result.remainingDebt,
        newHealthFactor: result.newHealthFactor,
        position: result.position
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/repay/total
 * Get total debt with interest for a position
 * 
 * GET /api/vesu/repay/total - Get total debt with interest
 */
router.get('/repay/total',
  repayRateLimit, //  Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    // : Add input validation for query params (positionId required)
    query('positionId').notEmpty().withMessage('positionId is required')
      .isString().withMessage('positionId must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { positionId } = req.query;

    try {
      //  Call VesuService.getTotalDebt(positionId)
      const result = await vesuService.getTotalDebt(positionId);

      //  Return 200 with { positionId, principalDebt, totalDebt, debtAsset }
      res.status(200).json({
        positionId: result.positionId,
        principalDebt: result.principalDebt,
        totalDebt: result.totalDebt,
        debtAsset: result.debtAsset
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

// ============================================================================
// WITHDRAW ENDPOINTS
// ============================================================================

/**
 * POST /api/vesu/withdraw
 * Withdraw supplied assets
 * 
 * POST /api/vesu/withdraw - Withdraw supplied assets
 */
router.post('/withdraw',
  withdrawRateLimit, //: Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add input validation (positionId, amount, walletAddress required)
    body('positionId').notEmpty().withMessage('positionId is required')
      .isString().withMessage('positionId must be a string'),
    body('amount').notEmpty().withMessage('amount is required')
      .isNumeric().withMessage('amount must be numeric'),
    body('walletAddress').notEmpty().withMessage('walletAddress is required')
      .isString().withMessage('walletAddress must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { positionId, amount, walletAddress } = req.body;

    try {
      //  Call VesuService.withdraw(positionId, amount, walletAddress)
      const result = await vesuService.withdraw(positionId, amount, walletAddress);

      // Return 200 with { success, transactionHash, withdrawnAmount, vTokensBurned, newHealthFactor, position }
      res.status(200).json({
        success: result.success,
        transactionHash: result.transactionHash,
        withdrawnAmount: result.withdrawnAmount,
        vTokensBurned: result.vTokensBurned,
        newHealthFactor: result.newHealthFactor,
        position: result.position
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/withdraw/max
 * Calculate maximum withdrawable amount for a position
 * 
 * GET /api/vesu/withdraw/max - Calculate maximum withdrawable amount
 */
router.get('/withdraw/max',
  withdrawRateLimit, //  Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add input validation for query params (positionId required)
    query('positionId').notEmpty().withMessage('positionId is required')
      .isString().withMessage('positionId must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { positionId } = req.query;

    try {
      // Fetch position and call VesuService.calculateMaxWithdrawable()
      const result = await vesuService.calculateMaxWithdrawable(positionId);

      // Return 200 with { positionId, maxWithdrawable, currentCollateral, currentDebt }
      res.status(200).json({
        positionId: result.positionId,
        maxWithdrawable: result.maxWithdrawable,
        currentCollateral: result.currentCollateral,
        currentDebt: result.currentDebt
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

// ============================================================================
// POSITION MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/vesu/positions
 * Get all positions for a user
 * 
 *  GET /api/vesu/positions - Get all user positions
 */
router.get('/positions',
  positionRateLimit, //  Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add pagination support (limit, offset query params)
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be a non-negative integer'),
    // Add status filter query parameter (optional)
    query('status').optional().isIn(['active', 'liquidated', 'closed']).withMessage('status must be active, liquidated, or closed'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const userId = req.user.id; // From JWT authentication
    const status = req.query.status || null;
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

    try {
      //  Call VesuService.getUserPositions(req.user.id, status, { limit, offset })
      const result = await vesuService.getUserPositions(userId, status, { limit, offset });

      //  Return 200 with { positions, pagination: { total, limit, offset, hasMore } }
      res.status(200).json({
        positions: result.positions,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.hasMore
        }
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/positions/:id
 * Get detailed position information
 * 
 *  GET /api/vesu/positions/:id - Get detailed position info
 */
router.get('/positions/:id',
  positionRateLimit, //  Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    param('id').notEmpty().withMessage('Position ID is required')
      .isString().withMessage('Position ID must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const positionId = req.params.id;
    const userId = req.user.id; // From JWT authentication

    try {
      //  Call VesuService.getPosition(positionId)
      const position = await vesuService.getPosition(positionId);

      // Validate position belongs to authenticated user
      if (position.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to access this position',
            details: {}
          }
        });
      }

      //  Return 200 with detailed position including calculated metrics
      res.status(200).json({
        position: position
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

/**
 * POST /api/vesu/positions/:id/sync
 * Sync position data from blockchain
 * 
 *  POST /api/vesu/positions/:id/sync - Sync position from blockchain
 */
router.post('/positions/:id/sync',
  positionRateLimit, //  Add rate limiting
  authenticateToken, // Add authentication middleware
  [
    param('id').notEmpty().withMessage('Position ID is required')
      .isString().withMessage('Position ID must be a string'),
    //  Add input validation (walletAddress required in body)
    body('walletAddress').notEmpty().withMessage('walletAddress is required')
      .isString().withMessage('walletAddress must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const positionId = req.params.id;
    const { walletAddress } = req.body;
    const userId = req.user.id; // From JWT authentication

    try {
      // Verify position belongs to user before syncing
      const position = await vesuService.getPosition(positionId);
      if (position.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to sync this position',
            details: {}
          }
        });
      }

      //Call VesuService.syncPositionFromChain(positionId, walletAddress)
      const updatedPosition = await vesuService.syncPositionFromChain(positionId, walletAddress);

      //  Return 200 with updated position data
      res.status(200).json({
        success: true,
        position: updatedPosition
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/positions/:id/health
 * Get position health metrics
 * 
 *  GET /api/vesu/positions/:id/health - Get position health metrics
 */
router.get('/positions/:id/health',
  positionRateLimit, //  Add rate limiting
  authenticateToken, //  Add authentication middleware
  [
    param('id').notEmpty().withMessage('Position ID is required')
      .isString().withMessage('Position ID must be a string'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const positionId = req.params.id;
    const userId = req.user.id; // From JWT authentication

    try {
      // Verify position belongs to user
      const position = await vesuService.getPosition(positionId);
      if (position.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to access this position',
            details: {}
          }
        });
      }

      //  Call VesuService.updatePositionHealth(positionId)
      const healthUpdate = await vesuService.updatePositionHealth(positionId);

      //  Return 200 with { positionId, healthFactor, ltv, prices, lastUpdated }
      res.status(200).json({
        positionId: healthUpdate.positionId,
        healthFactor: healthUpdate.healthFactor,
        ltv: healthUpdate.ltv,
        prices: healthUpdate.prices,
        lastUpdated: healthUpdate.lastUpdated
      });
    } catch (error) {
      handleVesuError(error, res);
    }
  })
);

// ============================================================================
// POOL INFORMATION ENDPOINTS
// ============================================================================

// Cache for pool data (5 minutes TTL)
const poolCache = {
  data: null,
  timestamp: null,
  ttl: 5 * 60 * 1000 // 5 minutes in milliseconds
};

/**
 * GET /api/vesu/pools
 * Get available lending pools
 * 
 *  GET /api/vesu/pools - Get available lending pools
 */
router.get('/pools',
  poolRateLimit, //  Add rate limiting
  asyncHandler(async (req, res) => {
    try {
      //  Check cache first (5 minutes TTL)
      const now = Date.now();
      if (poolCache.data && poolCache.timestamp && (now - poolCache.timestamp) < poolCache.ttl) {
        return res.status(200).json({
          pools: poolCache.data,
          cached: true,
          cacheAge: Math.floor((now - poolCache.timestamp) / 1000) // seconds
        });
      }

      //  Fetch active pools from VesuPool model (where is_active = true)
      const pools = await VesuPool.findAll({
        where: { is_active: true },
        order: [['total_supply', 'DESC']] // Order by TVL descending
      });

      const poolsWithStats = pools.map(pool => {
        const utilizationRate = pool.getUtilizationRate();
        const availableLiquidity = pool.getAvailableLiquidity();
        
        return {
          poolAddress: pool.pool_address,
          collateralAsset: pool.collateral_asset,
          debtAsset: pool.debt_asset,
          maxLTV: parseFloat(pool.max_ltv),
          liquidationThreshold: parseFloat(pool.liquidation_threshold),
          liquidationBonus: parseFloat(pool.liquidation_bonus),
          supplyAPY: pool.supply_apy ? parseFloat(pool.supply_apy) : null,
          borrowAPY: pool.borrow_apy ? parseFloat(pool.borrow_apy) : null,
          totalSupply: parseFloat(pool.total_supply),
          totalBorrow: parseFloat(pool.total_borrow),
          availableLiquidity: availableLiquidity,
          utilizationRate: utilizationRate,
          isActive: pool.is_active,
          lastSynced: pool.last_synced
        };
      });

      // Update cache
      poolCache.data = poolsWithStats;
      poolCache.timestamp = now;

      // Return 200 with { pools: [...] }
      res.status(200).json({
        pools: poolsWithStats,
        cached: false
      });
    } catch (error) {
      console.error('Error fetching pools:', error);
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/pools/:address
 * Get detailed pool information
 * 
 *  GET /api/vesu/pools/:address - Get detailed pool info
 */
router.get('/pools/:address',
  poolRateLimit, //  Add rate limiting
  [
    param('address').notEmpty().withMessage('Pool address is required')
      .isString().withMessage('Pool address must be a string')
      .matches(/^0x[a-fA-F0-9]{1,64}$/).withMessage('Invalid pool address format'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;

    const poolAddress = req.params.address;

    try {
      //  Fetch pool by address from VesuPool model
      const pool = await VesuPool.findOne({
        where: { pool_address: poolAddress }
      });

      //  Return 404 if pool not found
      if (!pool) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'POOL_NOT_FOUND',
            message: 'Pool not found',
            details: { poolAddress }
          }
        });
      }

      //  Return 200 with detailed pool information
      const utilizationRate = pool.getUtilizationRate();
      const availableLiquidity = pool.getAvailableLiquidity();
      const isHealthy = pool.isHealthy();

      res.status(200).json({
        pool: {
          id: pool.id,
          poolAddress: pool.pool_address,
          collateralAsset: pool.collateral_asset,
          debtAsset: pool.debt_asset,
          maxLTV: parseFloat(pool.max_ltv),
          liquidationThreshold: parseFloat(pool.liquidation_threshold),
          liquidationBonus: parseFloat(pool.liquidation_bonus),
          supplyAPY: pool.supply_apy ? parseFloat(pool.supply_apy) : null,
          borrowAPY: pool.borrow_apy ? parseFloat(pool.borrow_apy) : null,
          totalSupply: parseFloat(pool.total_supply),
          totalBorrow: parseFloat(pool.total_borrow),
          availableLiquidity: availableLiquidity,
          utilizationRate: utilizationRate,
          isActive: pool.is_active,
          isHealthy: isHealthy,
          lastSynced: pool.last_synced,
          createdAt: pool.createdAt,
          updatedAt: pool.updatedAt
        }
      });
    } catch (error) {
      console.error('Error fetching pool details:', error);
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/pools/:address/interest-rate
 * Get pool interest rates
 * 
 *  GET /api/vesu/pools/:address/interest-rate - Get pool interest rates
 */
router.get('/pools/:address/interest-rate',
  poolRateLimit, //  Add rate limiting
  [
    param('address').notEmpty().withMessage('Pool address is required')
      .isString().withMessage('Pool address must be a string')
      .matches(/^0x[a-fA-F0-9]{1,64}$/).withMessage('Invalid pool address format'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const poolAddress = req.params.address;

    try {
      // First verify pool exists
      const pool = await VesuPool.findOne({
        where: { pool_address: poolAddress }
      });

      if (!pool) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'POOL_NOT_FOUND',
            message: 'Pool not found',
            details: { poolAddress }
          }
        });
      }

      //  Call VesuService.getPoolInterestRate(poolAddress)
      const interestRateData = await vesuService.getPoolInterestRate(poolAddress);

      //  Return 200 with { poolAddress, borrowAPY, supplyAPY, collateralAsset, debtAsset }
      res.status(200).json({
        poolAddress: interestRateData.poolAddress,
        borrowAPY: interestRateData.borrowAPY,
        supplyAPY: interestRateData.supplyAPY,
        collateralAsset: pool.collateral_asset,
        debtAsset: pool.debt_asset
      });
    } catch (error) {
      console.error('Error fetching pool interest rates:', error);
      handleVesuError(error, res);
    }
  })
);

// ============================================================================
// LIQUIDATION ENDPOINTS
// ============================================================================

/**
 * GET /api/vesu/liquidations/opportunities
 * Get liquidatable positions (liquidator endpoint)
 * 
 *  GET /api/vesu/liquidations/opportunities - Get liquidatable positions
 */
router.get('/liquidations/opportunities',
  liquidationRateLimit, //  Add stricter rate limiting
  optionalAuth, //  Add authentication middleware (optional - can be public)
  asyncHandler(async (req, res) => {
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    try {
      //  Call LiquidationEngine.findLiquidatablePositions()
      const opportunities = await liquidationEngine.findLiquidatablePositions();

      //  Return 200 with { opportunities: [...] } including profit estimates
      res.status(200).json({
        opportunities: opportunities,
        count: opportunities.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error finding liquidation opportunities:', error);
      handleVesuError(error, res);
    }
  })
);

/**
 * POST /api/vesu/liquidations/execute
 * Execute a liquidation
 * 
 *  POST /api/vesu/liquidations/execute - Execute liquidation
 */
router.post('/liquidations/execute',
  liquidationRateLimit, //  Add stricter rate limiting
  authenticateToken, //  Add authentication middleware
  [
    //  Add input validation (positionId, debtToCover, liquidatorAddress required)
    body('positionId').notEmpty().withMessage('positionId is required')
      .isString().withMessage('positionId must be a string'),
    body('debtToCover').optional()
      .isNumeric().withMessage('debtToCover must be numeric'),
    body('liquidatorAddress').notEmpty().withMessage('liquidatorAddress is required')
      .isString().withMessage('liquidatorAddress must be a string')
      .matches(/^0x[a-fA-F0-9]{1,64}$/).withMessage('Invalid liquidator address format'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;
    
    // Check services availability
    if (!checkServicesAvailable(res)) return;

    const { positionId, debtToCover, liquidatorAddress } = req.body;

    try {
      //  Call LiquidationEngine.executeLiquidation()
      const result = await liquidationEngine.executeLiquidation(
        positionId,
        debtToCover || null, // Optional - defaults to full liquidation
        liquidatorAddress
      );

      //  Return 200 with { success, transactionHash, collateralSeized, debtRepaid, liquidationBonus }
      res.status(200).json({
        success: result.success,
        transactionHash: result.transactionHash,
        collateralSeized: result.liquidation.collateralSeized,
        debtRepaid: result.liquidation.debtRepaid,
        liquidationBonus: result.liquidation.liquidationBonus,
        liquidation: result.liquidation,
        position: result.position
      });
    } catch (error) {
      console.error('Error executing liquidation:', error);
      handleVesuError(error, res);
    }
  })
);

/**
 * GET /api/vesu/liquidations/history
 * Get liquidation history
 * 
 GET /api/vesu/liquidations/history - Get liquidation history
 */
router.get('/liquidations/history',
  liquidationRateLimit, //  Add stricter rate limiting
  [
    //  Add pagination support (limit, offset query params)
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('offset must be a non-negative integer'),
  ],
  asyncHandler(async (req, res) => {
    // Validate request
    if (!validateRequest(req, res)) return;

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    try {
      //  Fetch from VesuLiquidation model with joins to VesuPosition
      const { count, rows: liquidations } = await VesuLiquidation.findAndCountAll({
        include: [
          {
            model: VesuPosition,
            as: 'position',
            attributes: ['id', 'pool_address', 'collateral_asset', 'debt_asset', 'user_id', 'status']
          }
        ],
        order: [['timestamp', 'DESC']],
        limit: limit,
        offset: offset
      });

      // Format liquidation data
      const formattedLiquidations = liquidations.map(liq => ({
        id: liq.id,
        positionId: liq.position_id,
        liquidatorAddress: liq.liquidator_address,
        transactionHash: liq.transaction_hash,
        collateralSeized: liq.collateral_seized,
        debtRepaid: liq.debt_repaid,
        liquidationBonus: liq.liquidation_bonus,
        timestamp: liq.timestamp,
        position: liq.position ? {
          id: liq.position.id,
          poolAddress: liq.position.pool_address,
          collateralAsset: liq.position.collateral_asset,
          debtAsset: liq.position.debt_asset,
          userId: liq.position.user_id,
          status: liq.position.status
        } : null
      }));

      //  Return 200 with { liquidations: [...], pagination: { total, limit, offset, hasMore } }
      res.status(200).json({
        liquidations: formattedLiquidations,
        pagination: {
          total: count,
          limit: limit,
          offset: offset,
          hasMore: offset + limit < count
        }
      });
    } catch (error) {
      console.error('Error fetching liquidation history:', error);
      handleVesuError(error, res);
    }
  })
);

module.exports = router;
