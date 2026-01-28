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
const { supplyRateLimit, borrowRateLimit, repayRateLimit } = require('../middleware/rateLimit');
const { VesuService, VesuError } = require('../services/VesuService');
const LiquidationEngine = require('../services/LiquidationEngine');
const StarknetContractManager = require('../services/StarknetContractManager');
const { PragmaOracleService } = require('../services/PragmaOracleService');
const TransactionManager = require('../services/TransactionManager');

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
    // Task 15.1.2: Add input validation middleware
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
    // Task 16.1.2: Add input validation middleware
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
  borrowRateLimit, // Task 16.3: Add rate limiting
  authenticateToken, // Task 16.2.1: Add authentication middleware
  [
    // Task 16.2.2: Add input validation for query params
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
 * Task 17.1: POST /api/vesu/repay - Repay borrowed assets
 */
router.post('/repay',
  repayRateLimit, // Task 17.3: Add rate limiting
  authenticateToken, // Task 17.1.1: Add authentication middleware
  [
    // Task 17.1.2: Add input validation (positionId, amount, walletAddress required)
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
      // Task 17.1.3: Call VesuService.repay(positionId, amount, walletAddress)
      const result = await vesuService.repay(positionId, amount, walletAddress);

      // Task 17.1.4: Return 200 with { success, transactionHash, repaidAmount, remainingDebt, newHealthFactor, position }
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
 * Task 17.2: GET /api/vesu/repay/total - Get total debt with interest
 */
router.get('/repay/total',
  repayRateLimit, // Task 17.3: Add rate limiting
  authenticateToken, // Task 17.2.1: Add authentication middleware
  [
    // Task 17.2.2: Add input validation for query params (positionId required)
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
      // Task 17.2.3: Call VesuService.getTotalDebt(positionId)
      const result = await vesuService.getTotalDebt(positionId);

      // Task 17.2.4: Return 200 with { positionId, principalDebt, totalDebt, debtAsset }
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

module.exports = router;
