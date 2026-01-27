const Decimal = require('decimal.js');
const StarknetContractManager = require('./StarknetContractManager');
const { PragmaOracleService } = require('./PragmaOracleService');
const TransactionManager = require('./TransactionManager');
const { getVesuConfig, getPoolConfig, getAssetConfig } = require('../config/vesu.config');
const VesuPosition = require('../models/VesuPosition');
const VesuTransaction = require('../models/VesuTransaction');
const VesuPool = require('../models/VesuPool');

/**
 * Error codes for VesuService operations
 */
const ErrorCodes = {
  // Validation errors (400)
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_ADDRESS: 'INVALID_ADDRESS',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  INVALID_ASSET: 'INVALID_ASSET',
  INVALID_POOL: 'INVALID_POOL',
  
  // Business logic errors (422)
  LTV_EXCEEDED: 'LTV_EXCEEDED',
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  POSITION_UNDERCOLLATERALIZED: 'POSITION_UNDERCOLLATERALIZED',
  HEALTH_FACTOR_TOO_LOW: 'HEALTH_FACTOR_TOO_LOW',
  POOL_NOT_ACTIVE: 'POOL_NOT_ACTIVE',
  
  // External service errors (502/503)
  STARKNET_RPC_ERROR: 'STARKNET_RPC_ERROR',
  ORACLE_UNAVAILABLE: 'ORACLE_UNAVAILABLE',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  
  // System errors (500)
  DATABASE_ERROR: 'DATABASE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/**
 * Custom error class for Vesu operations
 */
class VesuError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VesuError';
    this.code = code;
    this.details = details;
  }
}

/**
 * VesuService
 * 
 * Core service for Vesu V2 lending protocol integration.
 * Handles supply, borrow, repay, withdraw operations and position management.
 */
class VesuService {
  /**
   * Initialize VesuService with required dependencies
   * @param {StarknetContractManager} contractManager - Contract manager instance
   * @param {PragmaOracleService} oracleService - Oracle service instance
   * @param {TransactionManager} transactionManager - Transaction manager instance
   */
  constructor(contractManager = null, oracleService = null, transactionManager = null) {
    // Initialize dependencies
    this.contracts = contractManager || new StarknetContractManager();
    this.oracle = oracleService || new PragmaOracleService();
    this.txManager = transactionManager || new TransactionManager(this.contracts.provider);
    
    // Load configuration
    this.config = getVesuConfig();
    
    // Set precision for decimal calculations
    Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });
    
    console.log('VesuService initialized');
  }

  // ============================================================================
  // HELPER METHODS FOR POSITION CALCULATIONS
  // ============================================================================

  /**
   * Calculate health factor for a position
   * Health Factor = (Risk-Adjusted Collateral Value) / (Debt Value)
   * 
   * @param {Object} position - Position data
   * @param {Object} prices - Asset prices { collateralAsset: price, debtAsset: price }
   * @returns {Decimal|null} Health factor (null if no debt)
   */
  calculateHealthFactor(position, prices) {
    try {
      // Validate inputs
      this._validatePosition(position);
      this._validatePrices(prices, position.collateralAsset, position.debtAsset);

      const collateralAmount = new Decimal(position.collateralAmount || position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debtAmount || position.debt_amount || 0);

      // If no debt, health factor is infinite (represented as null)
      if (debtAmount.isZero()) {
        return null;
      }

      // Get pool configuration for liquidation threshold
      const poolKey = `${position.collateralAsset}-${position.debtAsset}`;
      const poolConfig = getPoolConfig(poolKey);
      const liquidationThreshold = new Decimal(poolConfig.liquidationThreshold);

      // Calculate collateral value
      const collateralPrice = new Decimal(prices[position.collateralAsset]);
      const collateralValue = collateralAmount.mul(collateralPrice);

      // Apply liquidation threshold (risk adjustment)
      const riskAdjustedCollateralValue = collateralValue.mul(liquidationThreshold);

      // Calculate debt value
      const debtPrice = new Decimal(prices[position.debtAsset]);
      const debtValue = debtAmount.mul(debtPrice);

      // Health Factor = Risk-Adjusted Collateral Value / Debt Value
      const healthFactor = riskAdjustedCollateralValue.div(debtValue);

      return healthFactor;
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to calculate health factor: ${error.message}`,
        { position, prices }
      );
    }
  }

  /**
   * Calculate Loan-to-Value (LTV) ratio for a position
   * LTV = (Debt Value) / (Collateral Value)
   * 
   * @param {Object} position - Position data
   * @param {Object} prices - Asset prices
   * @returns {Decimal} LTV ratio (0 if no collateral)
   */
  calculateLTV(position, prices) {
    try {
      // Validate inputs
      this._validatePosition(position);
      this._validatePrices(prices, position.collateralAsset, position.debtAsset);

      const collateralAmount = new Decimal(position.collateralAmount || position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debtAmount || position.debt_amount || 0);

      // If no collateral, LTV is 0
      if (collateralAmount.isZero()) {
        return new Decimal(0);
      }

      // Calculate collateral value
      const collateralPrice = new Decimal(prices[position.collateralAsset]);
      const collateralValue = collateralAmount.mul(collateralPrice);

      // Calculate debt value
      const debtPrice = new Decimal(prices[position.debtAsset]);
      const debtValue = debtAmount.mul(debtPrice);

      // LTV = Debt Value / Collateral Value
      const ltv = debtValue.div(collateralValue);

      return ltv;
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to calculate LTV: ${error.message}`,
        { position, prices }
      );
    }
  }

  /**
   * Calculate maximum borrowable amount based on collateral and LTV
   * 
   * @param {Decimal} collateralAmount - Amount of collateral
   * @param {Decimal} collateralPrice - Price of collateral asset
   * @param {Decimal} debtPrice - Price of debt asset
   * @param {Decimal} maxLTV - Maximum LTV ratio
   * @returns {Decimal} Maximum borrowable amount in debt asset
   */
  calculateMaxBorrowable(collateralAmount, collateralPrice, debtPrice, maxLTV) {
    try {
      // Calculate collateral value
      const collateralValue = collateralAmount.mul(collateralPrice);

      // Calculate max debt value based on LTV
      const maxDebtValue = collateralValue.mul(maxLTV);

      // Convert to debt asset amount
      const maxBorrowable = maxDebtValue.div(debtPrice);

      return maxBorrowable;
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to calculate max borrowable: ${error.message}`,
        { collateralAmount, collateralPrice, debtPrice, maxLTV }
      );
    }
  }

  /**
   * Calculate maximum withdrawable amount considering debt
   * 
   * @param {Object} position - Position data
   * @param {Object} prices - Asset prices
   * @returns {Decimal} Maximum withdrawable amount in collateral asset
   */
  calculateMaxWithdrawable(position, prices) {
    try {
      // Validate inputs
      this._validatePosition(position);
      this._validatePrices(prices, position.collateralAsset, position.debtAsset);

      const collateralAmount = new Decimal(position.collateralAmount || position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debtAmount || position.debt_amount || 0);

      // If no debt, can withdraw all collateral
      if (debtAmount.isZero()) {
        return collateralAmount;
      }

      // Get pool configuration
      const poolKey = `${position.collateralAsset}-${position.debtAsset}`;
      const poolConfig = getPoolConfig(poolKey);
      const liquidationThreshold = new Decimal(poolConfig.liquidationThreshold);

      // Get prices
      const collateralPrice = new Decimal(prices[position.collateralAsset]);
      const debtPrice = new Decimal(prices[position.debtAsset]);

      // Calculate debt value
      const debtValue = debtAmount.mul(debtPrice);

      // Calculate minimum collateral value needed (to maintain health factor >= 1.0)
      // minCollateralValue * liquidationThreshold = debtValue
      const minCollateralValue = debtValue.div(liquidationThreshold);

      // Calculate minimum collateral amount needed
      const minCollateralAmount = minCollateralValue.div(collateralPrice);

      // Maximum withdrawable = current collateral - minimum required
      const maxWithdrawable = collateralAmount.sub(minCollateralAmount);

      // Cannot withdraw negative amount
      return Decimal.max(maxWithdrawable, new Decimal(0));
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to calculate max withdrawable: ${error.message}`,
        { position, prices }
      );
    }
  }

  /**
   * Calculate vTokens to receive for a supply amount
   * 
   * @param {Decimal} supplyAmount - Amount to supply
   * @param {Decimal} exchangeRate - vToken exchange rate (assets per share)
   * @returns {Decimal} vTokens to receive
   */
  calculateVTokensToReceive(supplyAmount, exchangeRate) {
    try {
      // vTokens = supplyAmount / exchangeRate
      const vTokens = supplyAmount.div(exchangeRate);
      return vTokens;
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to calculate vTokens: ${error.message}`,
        { supplyAmount, exchangeRate }
      );
    }
  }

  /**
   * Calculate underlying asset value from vTokens
   * 
   * @param {Decimal} vTokenAmount - Amount of vTokens
   * @param {Decimal} exchangeRate - vToken exchange rate (assets per share)
   * @returns {Decimal} Underlying asset value
   */
  calculateUnderlyingValue(vTokenAmount, exchangeRate) {
    try {
      // underlyingValue = vTokenAmount * exchangeRate
      const underlyingValue = vTokenAmount.mul(exchangeRate);
      return underlyingValue;
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to calculate underlying value: ${error.message}`,
        { vTokenAmount, exchangeRate }
      );
    }
  }

  // ============================================================================
  // ERROR HANDLING AND VALIDATION UTILITIES
  // ============================================================================

  /**
   * Validate amount is positive and within reasonable bounds
   * 
   * @param {string|number|Decimal} amount - Amount to validate
   * @param {string} fieldName - Field name for error message
   * @throws {VesuError} If amount is invalid
   */
  validateAmount(amount, fieldName = 'amount') {
    try {
      const amountDecimal = new Decimal(amount);
      
      if (amountDecimal.isNaN()) {
        throw new VesuError(
          ErrorCodes.INVALID_AMOUNT,
          `${fieldName} must be a valid number`,
          { amount, fieldName }
        );
      }

      if (amountDecimal.lte(0)) {
        throw new VesuError(
          ErrorCodes.INVALID_AMOUNT,
          `${fieldName} must be greater than zero`,
          { amount, fieldName }
        );
      }

      // Check for reasonable upper bound (prevent overflow)
      const maxAmount = new Decimal('1e36');
      if (amountDecimal.gt(maxAmount)) {
        throw new VesuError(
          ErrorCodes.INVALID_AMOUNT,
          `${fieldName} exceeds maximum allowed value`,
          { amount, fieldName, maxAmount: maxAmount.toString() }
        );
      }

      return amountDecimal;
    } catch (error) {
      if (error instanceof VesuError) {
        throw error;
      }
      throw new VesuError(
        ErrorCodes.INVALID_AMOUNT,
        `Invalid ${fieldName}: ${error.message}`,
        { amount, fieldName }
      );
    }
  }

  /**
   * Validate Starknet address format
   * 
   * @param {string} address - Address to validate
   * @param {string} fieldName - Field name for error message
   * @throws {VesuError} If address is invalid
   */
  validateAddress(address, fieldName = 'address') {
    if (!address || typeof address !== 'string') {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        `${fieldName} must be a string`,
        { address, fieldName }
      );
    }

    // Starknet addresses are hex strings with 0x prefix
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        `${fieldName} has invalid format`,
        { address, fieldName }
      );
    }

    return address;
  }

  /**
   * Validate asset symbol is supported
   * 
   * @param {string} asset - Asset symbol
   * @throws {VesuError} If asset is not supported
   */
  validateAsset(asset) {
    try {
      getAssetConfig(asset);
      return asset;
    } catch (error) {
      throw new VesuError(
        ErrorCodes.INVALID_ASSET,
        `Asset not supported: ${asset}`,
        { asset }
      );
    }
  }

  /**
   * Validate pool exists and is active
   * 
   * @param {string} poolAddress - Pool address
   * @throws {VesuError} If pool is invalid or inactive
   */
  async validatePool(poolAddress) {
    this.validateAddress(poolAddress, 'poolAddress');

    // Check if pool exists in database
    const pool = await VesuPool.findOne({ where: { pool_address: poolAddress } });
    
    if (!pool) {
      throw new VesuError(
        ErrorCodes.INVALID_POOL,
        `Pool not found: ${poolAddress}`,
        { poolAddress }
      );
    }

    if (!pool.is_active) {
      throw new VesuError(
        ErrorCodes.POOL_NOT_ACTIVE,
        `Pool is not active: ${poolAddress}`,
        { poolAddress }
      );
    }

    return pool;
  }

  /**
   * Validate position object has required fields
   * 
   * @param {Object} position - Position object
   * @throws {VesuError} If position is invalid
   */
  _validatePosition(position) {
    if (!position) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        'Position object is required',
        { position }
      );
    }

    const requiredFields = ['collateralAsset', 'debtAsset'];
    for (const field of requiredFields) {
      if (!position[field]) {
        throw new VesuError(
          ErrorCodes.INTERNAL_ERROR,
          `Position missing required field: ${field}`,
          { position }
        );
      }
    }
  }

  /**
   * Validate prices object has required asset prices
   * 
   * @param {Object} prices - Prices object
   * @param {string} collateralAsset - Collateral asset symbol
   * @param {string} debtAsset - Debt asset symbol
   * @throws {VesuError} If prices are invalid
   */
  _validatePrices(prices, collateralAsset, debtAsset) {
    if (!prices) {
      throw new VesuError(
        ErrorCodes.ORACLE_UNAVAILABLE,
        'Prices object is required',
        { prices }
      );
    }

    if (!prices[collateralAsset]) {
      throw new VesuError(
        ErrorCodes.ORACLE_UNAVAILABLE,
        `Price not available for collateral asset: ${collateralAsset}`,
        { prices, collateralAsset }
      );
    }

    if (!prices[debtAsset]) {
      throw new VesuError(
        ErrorCodes.ORACLE_UNAVAILABLE,
        `Price not available for debt asset: ${debtAsset}`,
        { prices, debtAsset }
      );
    }
  }

  /**
   * Wrap database operations with error handling
   * 
   * @param {Function} operation - Async database operation
   * @returns {Promise<any>} Operation result
   */
  async _withDatabaseErrorHandling(operation) {
    try {
      return await operation();
    } catch (error) {
      throw new VesuError(
        ErrorCodes.DATABASE_ERROR,
        `Database operation failed: ${error.message}`,
        { originalError: error.message }
      );
    }
  }

  /**
   * Wrap contract calls with error handling
   * 
   * @param {Function} operation - Async contract operation
   * @returns {Promise<any>} Operation result
   */
  async _withContractErrorHandling(operation) {
    try {
      return await operation();
    } catch (error) {
      throw new VesuError(
        ErrorCodes.STARKNET_RPC_ERROR,
        `Contract operation failed: ${error.message}`,
        { originalError: error.message }
      );
    }
  }

  /**
   * Wrap oracle calls with error handling
   * 
   * @param {Function} operation - Async oracle operation
   * @returns {Promise<any>} Operation result
   */
  async _withOracleErrorHandling(operation) {
    try {
      return await operation();
    } catch (error) {
      throw new VesuError(
        ErrorCodes.ORACLE_UNAVAILABLE,
        `Oracle operation failed: ${error.message}`,
        { originalError: error.message }
      );
    }
  }
}

module.exports = {
  VesuService,
  VesuError,
  ErrorCodes,
};
