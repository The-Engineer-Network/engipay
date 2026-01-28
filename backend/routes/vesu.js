const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
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

module.exports = router;
