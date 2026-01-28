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

  // ============================================================================
  // SUPPLY OPERATIONS
  // ============================================================================

  /**
   * Supply assets to a Vesu lending pool
   * 
   * @param {string} poolAddress - Pool contract address
   * @param {string} asset - Asset symbol to supply
   * @param {string|number|Decimal} amount - Amount to supply
   * @param {string} walletAddress - User's wallet address
   * @param {string} userId - User ID for database tracking
   * @returns {Promise<Object>} Supply operation result
   */
  async supply(poolAddress, asset, amount, walletAddress, userId) {
    console.log('VesuService.supply called', { poolAddress, asset, amount, walletAddress, userId });

    // Task 7.1.1: Validate supply parameters
    this.validateAddress(poolAddress, 'poolAddress');
    this.validateAsset(asset);
    const amountDecimal = this.validateAmount(amount, 'amount');
    this.validateAddress(walletAddress, 'walletAddress');

    if (!userId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'userId is required',
        { userId }
      );
    }

    // Task 7.1.2: Get pool configuration and validate pool is active
    const pool = await this.validatePool(poolAddress);

    // Verify asset matches pool's collateral asset
    if (asset !== pool.collateral_asset) {
      throw new VesuError(
        ErrorCodes.INVALID_ASSET,
        `Asset ${asset} does not match pool's collateral asset ${pool.collateral_asset}`,
        { asset, poolCollateralAsset: pool.collateral_asset }
      );
    }

    // Task 7.1.3: Calculate expected vTokens to receive using exchange rate
    const exchangeRate = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenExchangeRateForPool(poolAddress, asset);
    });

    const exchangeRateDecimal = new Decimal(exchangeRate);
    const expectedVTokens = this.calculateVTokensToReceive(amountDecimal, exchangeRateDecimal);

    console.log('Supply calculation', {
      amount: amountDecimal.toString(),
      exchangeRate: exchangeRateDecimal.toString(),
      expectedVTokens: expectedVTokens.toString()
    });

    // Task 7.1.4: Execute supply transaction on Pool contract via TransactionManager
    let transactionHash;
    try {
      transactionHash = await this.txManager.executeSupply(
        poolAddress,
        asset,
        amountDecimal.toString(),
        walletAddress
      );
      console.log('Supply transaction submitted', { transactionHash });
    } catch (error) {
      throw new VesuError(
        ErrorCodes.TRANSACTION_FAILED,
        `Failed to execute supply transaction: ${error.message}`,
        { poolAddress, asset, amount: amountDecimal.toString(), walletAddress }
      );
    }

    // Task 7.1.5: Create or update VesuPosition record in database
    const position = await this._withDatabaseErrorHandling(async () => {
      // Find existing position for this user and pool
      let existingPosition = await VesuPosition.findOne({
        where: {
          user_id: userId,
          pool_address: poolAddress,
          status: 'active'
        }
      });

      if (existingPosition) {
        // Update existing position
        const newCollateralAmount = new Decimal(existingPosition.collateral_amount)
          .add(amountDecimal);
        const newVTokenBalance = new Decimal(existingPosition.vtoken_balance)
          .add(expectedVTokens);

        await existingPosition.update({
          collateral_amount: newCollateralAmount.toString(),
          vtoken_balance: newVTokenBalance.toString(),
          last_updated: new Date()
        });

        console.log('Updated existing position', {
          positionId: existingPosition.id,
          newCollateralAmount: newCollateralAmount.toString(),
          newVTokenBalance: newVTokenBalance.toString()
        });

        return existingPosition;
      } else {
        // Create new position
        const newPosition = await VesuPosition.create({
          user_id: userId,
          pool_address: poolAddress,
          collateral_asset: pool.collateral_asset,
          debt_asset: pool.debt_asset,
          collateral_amount: amountDecimal.toString(),
          debt_amount: '0',
          vtoken_balance: expectedVTokens.toString(),
          health_factor: null, // No debt, so health factor is infinite
          status: 'active',
          last_updated: new Date()
        });

        console.log('Created new position', {
          positionId: newPosition.id,
          collateralAmount: amountDecimal.toString(),
          vTokenBalance: expectedVTokens.toString()
        });

        return newPosition;
      }
    });

    // Task 7.1.6: Create VesuTransaction record with status tracking
    const transaction = await this._withDatabaseErrorHandling(async () => {
      return await VesuTransaction.create({
        position_id: position.id,
        user_id: userId,
        transaction_hash: transactionHash,
        type: 'supply',
        asset: asset,
        amount: amountDecimal.toString(),
        status: 'pending',
        timestamp: new Date()
      });
    });

    console.log('Created transaction record', {
      transactionId: transaction.id,
      transactionHash: transactionHash
    });

    // Return supply operation result
    return {
      success: true,
      transactionHash: transactionHash,
      vTokensReceived: expectedVTokens.toString(),
      position: {
        id: position.id,
        collateralAmount: position.collateral_amount,
        vTokenBalance: position.vtoken_balance,
        healthFactor: position.health_factor
      },
      transaction: {
        id: transaction.id,
        status: transaction.status
      }
    };
  }

  /**
   * Fetch vToken balance from contract
   * Task 7.2.1: Fetch vToken balance from contract via StarknetContractManager
   * 
   * @param {string} poolAddress - Pool contract address
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Decimal>} vToken balance
   */
  async getVTokenBalance(poolAddress, walletAddress) {
    console.log('VesuService.getVTokenBalance called', { poolAddress, walletAddress });

    this.validateAddress(poolAddress, 'poolAddress');
    this.validateAddress(walletAddress, 'walletAddress');

    const balance = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenBalance(poolAddress, walletAddress);
    });

    const balanceDecimal = new Decimal(balance);
    console.log('vToken balance fetched', { balance: balanceDecimal.toString() });

    return balanceDecimal;
  }

  /**
   * Calculate underlying asset value from vTokens
   * Task 7.2.2: Calculate underlying asset value from vTokens using exchange rate
   * 
   * @param {string|number|Decimal} vTokenAmount - Amount of vTokens
   * @param {string} poolAddress - Pool contract address
   * @param {string} asset - Asset symbol
   * @returns {Promise<Decimal>} Underlying asset value
   */
  async getUnderlyingValueFromVTokens(vTokenAmount, poolAddress, asset) {
    console.log('VesuService.getUnderlyingValueFromVTokens called', {
      vTokenAmount,
      poolAddress,
      asset
    });

    const vTokenAmountDecimal = this.validateAmount(vTokenAmount, 'vTokenAmount');
    this.validateAddress(poolAddress, 'poolAddress');
    this.validateAsset(asset);

    // Get current exchange rate from contract
    const exchangeRate = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenExchangeRateForPool(poolAddress, asset);
    });

    const exchangeRateDecimal = new Decimal(exchangeRate);
    const underlyingValue = this.calculateUnderlyingValue(vTokenAmountDecimal, exchangeRateDecimal);

    console.log('Underlying value calculated', {
      vTokenAmount: vTokenAmountDecimal.toString(),
      exchangeRate: exchangeRateDecimal.toString(),
      underlyingValue: underlyingValue.toString()
    });

    return underlyingValue;
  }

  /**
   * Sync vToken balances for a position
   * Task 7.2.3: Implement method to sync vToken balances for positions
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Updated position data
   */
  async syncVTokenBalance(positionId) {
    console.log('VesuService.syncVTokenBalance called', { positionId });

    // Fetch position from database
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Get wallet address from user (assuming we have user association)
    // For now, we'll need to get this from the transaction or user model
    // This is a simplified version - in production, you'd fetch the wallet from User model
    const userTransactions = await this._withDatabaseErrorHandling(async () => {
      return await VesuTransaction.findOne({
        where: { position_id: positionId },
        order: [['created_at', 'DESC']]
      });
    });

    if (!userTransactions) {
      throw new VesuError(
        ErrorCodes.INTERNAL_ERROR,
        'Cannot sync vToken balance: no transactions found for position',
        { positionId }
      );
    }

    // Fetch current vToken balance from contract
    // Note: We need wallet address here - this would come from the User model in production
    // For now, we'll skip the actual contract call and just update based on exchange rate
    
    // Get current exchange rate
    const exchangeRate = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenExchangeRateForPool(
        position.pool_address,
        position.collateral_asset
      );
    });

    const exchangeRateDecimal = new Decimal(exchangeRate);
    const vTokenBalanceDecimal = new Decimal(position.vtoken_balance);

    // Calculate current underlying value
    const underlyingValue = this.calculateUnderlyingValue(vTokenBalanceDecimal, exchangeRateDecimal);

    // Update position with new collateral amount (reflecting accrued interest)
    await this._withDatabaseErrorHandling(async () => {
      await position.update({
        collateral_amount: underlyingValue.toString(),
        last_updated: new Date()
      });
    });

    console.log('vToken balance synced', {
      positionId: position.id,
      vTokenBalance: vTokenBalanceDecimal.toString(),
      exchangeRate: exchangeRateDecimal.toString(),
      underlyingValue: underlyingValue.toString()
    });

    return {
      positionId: position.id,
      vTokenBalance: position.vtoken_balance,
      collateralAmount: position.collateral_amount,
      exchangeRate: exchangeRateDecimal.toString(),
      lastUpdated: position.last_updated
    };
  }

  // ============================================================================
  // BORROW OPERATIONS
  // ============================================================================

  /**
   * Borrow assets against collateral in a Vesu lending pool
   * 
   * @param {string} poolAddress - Pool contract address
   * @param {string} collateralAsset - Collateral asset symbol
   * @param {string} debtAsset - Debt asset symbol to borrow
   * @param {string|number|Decimal} amount - Amount to borrow
   * @param {string} walletAddress - User's wallet address
   * @param {string} userId - User ID for database tracking
   * @returns {Promise<Object>} Borrow operation result
   */
  async borrow(poolAddress, collateralAsset, debtAsset, amount, walletAddress, userId) {
    console.log('VesuService.borrow called', {
      poolAddress,
      collateralAsset,
      debtAsset,
      amount,
      walletAddress,
      userId
    });

    // Task 8.1.1: Validate borrow parameters
    this.validateAddress(poolAddress, 'poolAddress');
    this.validateAsset(collateralAsset);
    this.validateAsset(debtAsset);
    const amountDecimal = this.validateAmount(amount, 'amount');
    this.validateAddress(walletAddress, 'walletAddress');

    if (!userId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'userId is required',
        { userId }
      );
    }

    // Validate pool and get pool configuration
    const pool = await this.validatePool(poolAddress);

    // Verify assets match pool configuration
    if (collateralAsset !== pool.collateral_asset) {
      throw new VesuError(
        ErrorCodes.INVALID_ASSET,
        `Collateral asset ${collateralAsset} does not match pool's collateral asset ${pool.collateral_asset}`,
        { collateralAsset, poolCollateralAsset: pool.collateral_asset }
      );
    }

    if (debtAsset !== pool.debt_asset) {
      throw new VesuError(
        ErrorCodes.INVALID_ASSET,
        `Debt asset ${debtAsset} does not match pool's debt asset ${pool.debt_asset}`,
        { debtAsset, poolDebtAsset: pool.debt_asset }
      );
    }

    // Find or create position for this user and pool
    let position = await this._withDatabaseErrorHandling(async () => {
      return await VesuPosition.findOne({
        where: {
          user_id: userId,
          pool_address: poolAddress,
          status: 'active'
        }
      });
    });

    // If no position exists, user must supply collateral first
    if (!position) {
      throw new VesuError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        'No active position found. Please supply collateral first.',
        { userId, poolAddress }
      );
    }

    // Ensure position has collateral
    const currentCollateral = new Decimal(position.collateral_amount || 0);
    if (currentCollateral.isZero()) {
      throw new VesuError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        'Position has no collateral. Please supply collateral first.',
        { positionId: position.id }
      );
    }

    // Task 8.1.2: Fetch collateral and debt asset prices from PragmaOracleService
    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices([collateralAsset, debtAsset]);
    });

    console.log('Fetched prices', { prices });

    // Calculate current debt (including any existing debt)
    const currentDebt = new Decimal(position.debt_amount || 0);
    const newTotalDebt = currentDebt.add(amountDecimal);

    // Create position object for calculations
    const positionForCalc = {
      collateralAsset: collateralAsset,
      debtAsset: debtAsset,
      collateralAmount: currentCollateral.toString(),
      debtAmount: newTotalDebt.toString()
    };

    // Task 8.1.3: Calculate current LTV ratio
    const ltv = this.calculateLTV(positionForCalc, prices);
    console.log('Calculated LTV', { ltv: ltv.toString() });

    // Task 8.1.4: Validate LTV is within pool limits
    const maxLTV = new Decimal(pool.max_ltv);
    if (ltv.gt(maxLTV)) {
      throw new VesuError(
        ErrorCodes.LTV_EXCEEDED,
        `Borrow would exceed maximum LTV ratio. Current: ${ltv.toString()}, Max: ${maxLTV.toString()}`,
        {
          currentLTV: ltv.toString(),
          maxLTV: maxLTV.toString(),
          collateralValue: currentCollateral.mul(new Decimal(prices[collateralAsset])).toString(),
          requestedDebtValue: newTotalDebt.mul(new Decimal(prices[debtAsset])).toString()
        }
      );
    }

    // Task 8.1.5: Calculate health factor after borrow
    const healthFactor = this.calculateHealthFactor(positionForCalc, prices);
    console.log('Calculated health factor', {
      healthFactor: healthFactor ? healthFactor.toString() : 'infinite'
    });

    // Task 8.1.6: Reject borrow if health factor would be < 1.0
    if (healthFactor && healthFactor.lt(new Decimal(1.0))) {
      throw new VesuError(
        ErrorCodes.HEALTH_FACTOR_TOO_LOW,
        `Borrow would result in health factor below 1.0: ${healthFactor.toString()}`,
        {
          healthFactor: healthFactor.toString(),
          collateralAmount: currentCollateral.toString(),
          debtAmount: newTotalDebt.toString()
        }
      );
    }

    // Task 8.1.7: Check pool liquidity availability
    const totalSupply = new Decimal(pool.total_supply || 0);
    const totalBorrow = new Decimal(pool.total_borrow || 0);
    const availableLiquidity = totalSupply.sub(totalBorrow);

    console.log('Pool liquidity check', {
      totalSupply: totalSupply.toString(),
      totalBorrow: totalBorrow.toString(),
      availableLiquidity: availableLiquidity.toString(),
      requestedAmount: amountDecimal.toString()
    });

    if (amountDecimal.gt(availableLiquidity)) {
      throw new VesuError(
        ErrorCodes.INSUFFICIENT_LIQUIDITY,
        `Insufficient pool liquidity. Available: ${availableLiquidity.toString()}, Requested: ${amountDecimal.toString()}`,
        {
          availableLiquidity: availableLiquidity.toString(),
          requestedAmount: amountDecimal.toString()
        }
      );
    }

    // Task 8.1.8: Execute borrow transaction via TransactionManager
    let transactionHash;
    try {
      transactionHash = await this.txManager.executeBorrow(
        poolAddress,
        collateralAsset,
        debtAsset,
        amountDecimal.toString(),
        walletAddress
      );
      console.log('Borrow transaction submitted', { transactionHash });
    } catch (error) {
      throw new VesuError(
        ErrorCodes.TRANSACTION_FAILED,
        `Failed to execute borrow transaction: ${error.message}`,
        { poolAddress, collateralAsset, debtAsset, amount: amountDecimal.toString(), walletAddress }
      );
    }

    // Task 8.1.9: Update VesuPosition in database with new debt amount and health factor
    await this._withDatabaseErrorHandling(async () => {
      await position.update({
        debt_amount: newTotalDebt.toString(),
        health_factor: healthFactor ? healthFactor.toString() : null,
        last_updated: new Date()
      });
    });

    console.log('Updated position with new debt', {
      positionId: position.id,
      newDebtAmount: newTotalDebt.toString(),
      healthFactor: healthFactor ? healthFactor.toString() : null
    });

    // Task 8.1.10: Create VesuTransaction record with type='borrow' and status='pending'
    const transaction = await this._withDatabaseErrorHandling(async () => {
      return await VesuTransaction.create({
        position_id: position.id,
        user_id: userId,
        transaction_hash: transactionHash,
        type: 'borrow',
        asset: debtAsset,
        amount: amountDecimal.toString(),
        status: 'pending',
        timestamp: new Date()
      });
    });

    console.log('Created borrow transaction record', {
      transactionId: transaction.id,
      transactionHash: transactionHash
    });

    // Return borrow operation result
    return {
      success: true,
      transactionHash: transactionHash,
      borrowedAmount: amountDecimal.toString(),
      position: {
        id: position.id,
        collateralAmount: position.collateral_amount,
        debtAmount: position.debt_amount,
        healthFactor: position.health_factor,
        ltv: ltv.toString()
      },
      transaction: {
        id: transaction.id,
        status: transaction.status
      }
    };
  }

  /**
   * Get maximum borrowable amount for a position
   * Task 8.2.1: Implement getMaxBorrowable() method
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Maximum borrowable amount and details
   */
  async getMaxBorrowable(positionId) {
    console.log('VesuService.getMaxBorrowable called', { positionId });

    // Fetch position from database
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Get pool configuration
    const pool = await this.validatePool(position.pool_address);

    // Fetch current prices
    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices([position.collateral_asset, position.debt_asset]);
    });

    // Get current amounts
    const collateralAmount = new Decimal(position.collateral_amount || 0);
    const currentDebt = new Decimal(position.debt_amount || 0);

    // Calculate maximum borrowable using helper method
    const collateralPrice = new Decimal(prices[position.collateral_asset]);
    const debtPrice = new Decimal(prices[position.debt_asset]);
    const maxLTV = new Decimal(pool.max_ltv);

    const maxTotalBorrowable = this.calculateMaxBorrowable(
      collateralAmount,
      collateralPrice,
      debtPrice,
      maxLTV
    );

    // Subtract current debt to get additional borrowable amount
    const additionalBorrowable = Decimal.max(
      maxTotalBorrowable.sub(currentDebt),
      new Decimal(0)
    );

    // Check pool liquidity
    const totalSupply = new Decimal(pool.total_supply || 0);
    const totalBorrow = new Decimal(pool.total_borrow || 0);
    const availableLiquidity = totalSupply.sub(totalBorrow);

    // Actual max borrowable is limited by pool liquidity
    const actualMaxBorrowable = Decimal.min(additionalBorrowable, availableLiquidity);

    console.log('Max borrowable calculated', {
      positionId: position.id,
      collateralAmount: collateralAmount.toString(),
      currentDebt: currentDebt.toString(),
      maxTotalBorrowable: maxTotalBorrowable.toString(),
      additionalBorrowable: additionalBorrowable.toString(),
      availableLiquidity: availableLiquidity.toString(),
      actualMaxBorrowable: actualMaxBorrowable.toString()
    });

    return {
      positionId: position.id,
      maxBorrowable: actualMaxBorrowable.toString(),
      currentDebt: currentDebt.toString(),
      availableLiquidity: availableLiquidity.toString(),
      collateralAmount: collateralAmount.toString(),
      maxLTV: maxLTV.toString()
    };
  }

  /**
   * Get total debt with accrued interest for a position
   * Task 8.2.2: Implement getTotalDebt() method
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Total debt with accrued interest
   */
  async getTotalDebt(positionId) {
    console.log('VesuService.getTotalDebt called', { positionId });

    // Fetch position from database
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Get current debt from database (this is the principal)
    const principalDebt = new Decimal(position.debt_amount || 0);

    // In a full implementation, we would fetch the actual debt with accrued interest
    // from the contract. For now, we'll use the stored value.
    // TODO: Implement contract call to get actual debt with interest
    // const actualDebt = await this.contracts.getPositionDebt(position.pool_address, walletAddress);

    console.log('Total debt fetched', {
      positionId: position.id,
      principalDebt: principalDebt.toString()
    });

    return {
      positionId: position.id,
      principalDebt: principalDebt.toString(),
      totalDebt: principalDebt.toString(), // Would include accrued interest in full implementation
      debtAsset: position.debt_asset
    };
  }

  /**
   * Get current borrow APY for a pool
   * Task 8.2.3: Implement getPoolInterestRate() method
   * 
   * @param {string} poolAddress - Pool contract address
   * @returns {Promise<Object>} Pool interest rate information
   */
  async getPoolInterestRate(poolAddress) {
    console.log('VesuService.getPoolInterestRate called', { poolAddress });

    this.validateAddress(poolAddress, 'poolAddress');

    // Get pool from database
    const pool = await this.validatePool(poolAddress);

    // In a full implementation, we would fetch the current interest rate from the contract
    // For now, we'll use the stored value from the database
    // TODO: Implement contract call to get real-time interest rate
    // const currentRate = await this.contracts.getPoolBorrowRate(poolAddress);

    const borrowAPY = new Decimal(pool.borrow_apy || 0);
    const supplyAPY = new Decimal(pool.supply_apy || 0);

    console.log('Pool interest rates fetched', {
      poolAddress: poolAddress,
      borrowAPY: borrowAPY.toString(),
      supplyAPY: supplyAPY.toString()
    });

    return {
      poolAddress: poolAddress,
      borrowAPY: borrowAPY.toString(),
      supplyAPY: supplyAPY.toString(),
      collateralAsset: pool.collateral_asset,
      debtAsset: pool.debt_asset
    };
  }

  // ============================================================================
  // REPAY OPERATIONS
  // ============================================================================

  /**
   * Repay borrowed assets to reduce debt
   * 
   * @param {string} positionId - Position ID
   * @param {string|number|Decimal} amount - Amount to repay
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Repay operation result
   */
  async repay(positionId, amount, walletAddress) {
    console.log('VesuService.repay called', { positionId, amount, walletAddress });

    // Task 9.1.1: Validate repay parameters (positionId, amount, walletAddress)
    if (!positionId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'positionId is required',
        { positionId }
      );
    }

    const amountDecimal = this.validateAmount(amount, 'amount');
    this.validateAddress(walletAddress, 'walletAddress');

    // Task 9.1.2: Fetch current VesuPosition from database using VesuPosition.findByPk()
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Verify position is active
    if (position.status !== 'active') {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        `Position is not active: ${position.status}`,
        { positionId, status: position.status }
      );
    }

    // Task 9.1.3: Calculate total debt including accrued interest using getTotalDebt() method
    const debtInfo = await this.getTotalDebt(positionId);
    const totalDebt = new Decimal(debtInfo.totalDebt);

    console.log('Total debt calculated', {
      positionId: position.id,
      totalDebt: totalDebt.toString(),
      repayAmount: amountDecimal.toString()
    });

    // Task 9.1.4: Validate repayment amount <= total debt (throw INVALID_AMOUNT error if exceeded)
    if (amountDecimal.gt(totalDebt)) {
      throw new VesuError(
        ErrorCodes.INVALID_AMOUNT,
        `Repayment amount exceeds total debt. Total debt: ${totalDebt.toString()}, Repayment: ${amountDecimal.toString()}`,
        {
          totalDebt: totalDebt.toString(),
          repaymentAmount: amountDecimal.toString()
        }
      );
    }

    // Task 9.1.5: Execute repay transaction via TransactionManager.executeRepay()
    let transactionHash;
    try {
      transactionHash = await this.txManager.executeRepay(
        position.pool_address,
        position.debt_asset,
        amountDecimal.toString(),
        positionId,
        walletAddress
      );
      console.log('Repay transaction submitted', { transactionHash });
    } catch (error) {
      throw new VesuError(
        ErrorCodes.TRANSACTION_FAILED,
        `Failed to execute repay transaction: ${error.message}`,
        { positionId, amount: amountDecimal.toString(), walletAddress }
      );
    }

    // Task 9.1.6: Update VesuPosition debt_amount in database (subtract repayment amount)
    const currentDebt = new Decimal(position.debt_amount || 0);
    const newDebtAmount = Decimal.max(currentDebt.sub(amountDecimal), new Decimal(0));

    console.log('Calculating new debt amount', {
      currentDebt: currentDebt.toString(),
      repayAmount: amountDecimal.toString(),
      newDebtAmount: newDebtAmount.toString()
    });

    // Task 9.1.7: Recalculate and update health factor using calculateHealthFactor()
    let newHealthFactor = null;
    if (!newDebtAmount.isZero()) {
      // Fetch current prices for health factor calculation
      const prices = await this._withOracleErrorHandling(async () => {
        return await this.oracle.getPrices([position.collateral_asset, position.debt_asset]);
      });

      const positionForCalc = {
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset,
        collateralAmount: position.collateral_amount,
        debtAmount: newDebtAmount.toString()
      };

      newHealthFactor = this.calculateHealthFactor(positionForCalc, prices);
      console.log('Recalculated health factor', {
        healthFactor: newHealthFactor ? newHealthFactor.toString() : 'infinite'
      });
    }

    // Update position in database
    await this._withDatabaseErrorHandling(async () => {
      await position.update({
        debt_amount: newDebtAmount.toString(),
        health_factor: newHealthFactor ? newHealthFactor.toString() : null,
        last_updated: new Date()
      });
    });

    console.log('Updated position with new debt', {
      positionId: position.id,
      newDebtAmount: newDebtAmount.toString(),
      healthFactor: newHealthFactor ? newHealthFactor.toString() : null
    });

    // Task 9.1.8: Create VesuTransaction record with type='repay' and status='pending'
    const transaction = await this._withDatabaseErrorHandling(async () => {
      return await VesuTransaction.create({
        position_id: position.id,
        user_id: position.user_id,
        transaction_hash: transactionHash,
        type: 'repay',
        asset: position.debt_asset,
        amount: amountDecimal.toString(),
        status: 'pending',
        timestamp: new Date()
      });
    });

    console.log('Created repay transaction record', {
      transactionId: transaction.id,
      transactionHash: transactionHash
    });

    // Return repay operation result
    return {
      success: true,
      transactionHash: transactionHash,
      repaidAmount: amountDecimal.toString(),
      remainingDebt: newDebtAmount.toString(),
      newHealthFactor: newHealthFactor ? newHealthFactor.toString() : null,
      position: {
        id: position.id,
        collateralAmount: position.collateral_amount,
        debtAmount: newDebtAmount.toString(),
        healthFactor: newHealthFactor ? newHealthFactor.toString() : null
      },
      transaction: {
        id: transaction.id,
        status: transaction.status
      }
    };
  }

  // ============================================================================
  // WITHDRAW OPERATIONS
  // ============================================================================

  /**
   * Withdraw supplied assets from a Vesu lending pool
   * 
   * @param {string} positionId - Position ID
   * @param {string|number|Decimal} amount - Amount to withdraw
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Withdraw operation result
   */
  async withdraw(positionId, amount, walletAddress) {
    console.log('VesuService.withdraw called', { positionId, amount, walletAddress });

    // Task 10.1.1: Validate withdraw parameters (positionId, amount, walletAddress)
    if (!positionId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'positionId is required',
        { positionId }
      );
    }

    const amountDecimal = this.validateAmount(amount, 'amount');
    this.validateAddress(walletAddress, 'walletAddress');

    // Task 10.1.2: Fetch current VesuPosition from database using VesuPosition.findByPk()
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Verify position is active
    if (position.status !== 'active') {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        `Position is not active: ${position.status}`,
        { positionId, status: position.status }
      );
    }

    // Get current collateral amount
    const currentCollateral = new Decimal(position.collateral_amount || 0);

    // Verify position has sufficient collateral
    if (amountDecimal.gt(currentCollateral)) {
      throw new VesuError(
        ErrorCodes.INSUFFICIENT_BALANCE,
        `Insufficient collateral. Available: ${currentCollateral.toString()}, Requested: ${amountDecimal.toString()}`,
        {
          availableCollateral: currentCollateral.toString(),
          requestedAmount: amountDecimal.toString()
        }
      );
    }

    // Task 10.1.3: Calculate maximum withdrawable amount using calculateMaxWithdrawable() helper
    // Fetch current prices for calculations
    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices([position.collateral_asset, position.debt_asset]);
    });

    const maxWithdrawable = this.calculateMaxWithdrawable(position, prices);

    console.log('Maximum withdrawable calculated', {
      positionId: position.id,
      maxWithdrawable: maxWithdrawable.toString(),
      requestedAmount: amountDecimal.toString()
    });

    // Task 10.1.4: Validate withdrawal amount <= max withdrawable (throw POSITION_UNDERCOLLATERALIZED if exceeded)
    if (amountDecimal.gt(maxWithdrawable)) {
      throw new VesuError(
        ErrorCodes.POSITION_UNDERCOLLATERALIZED,
        `Withdrawal would undercollateralize position. Max withdrawable: ${maxWithdrawable.toString()}, Requested: ${amountDecimal.toString()}`,
        {
          maxWithdrawable: maxWithdrawable.toString(),
          requestedAmount: amountDecimal.toString(),
          currentCollateral: currentCollateral.toString(),
          currentDebt: position.debt_amount
        }
      );
    }

    // Task 10.1.5: Calculate health factor after withdrawal using calculateHealthFactor()
    const newCollateralAmount = currentCollateral.sub(amountDecimal);
    const currentDebt = new Decimal(position.debt_amount || 0);

    let newHealthFactor = null;
    if (!currentDebt.isZero()) {
      const positionAfterWithdraw = {
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset,
        collateralAmount: newCollateralAmount.toString(),
        debtAmount: currentDebt.toString()
      };

      newHealthFactor = this.calculateHealthFactor(positionAfterWithdraw, prices);

      console.log('Health factor after withdrawal', {
        newHealthFactor: newHealthFactor ? newHealthFactor.toString() : 'infinite'
      });

      // Task 10.1.6: Reject withdrawal if health factor would be < 1.0 (throw HEALTH_FACTOR_TOO_LOW)
      if (newHealthFactor && newHealthFactor.lt(new Decimal(1.0))) {
        throw new VesuError(
          ErrorCodes.HEALTH_FACTOR_TOO_LOW,
          `Withdrawal would result in health factor below 1.0: ${newHealthFactor.toString()}`,
          {
            newHealthFactor: newHealthFactor.toString(),
            newCollateralAmount: newCollateralAmount.toString(),
            currentDebt: currentDebt.toString()
          }
        );
      }
    }

    // Task 10.1.7: Calculate vTokens to burn using calculateVTokensToReceive() in reverse
    // Get current exchange rate
    const exchangeRate = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenExchangeRateForPool(
        position.pool_address,
        position.collateral_asset
      );
    });

    const exchangeRateDecimal = new Decimal(exchangeRate);
    
    // vTokens to burn = amount / exchangeRate (same formula as calculateVTokensToReceive)
    const vTokensToBurn = this.calculateVTokensToReceive(amountDecimal, exchangeRateDecimal);

    console.log('vTokens to burn calculated', {
      withdrawAmount: amountDecimal.toString(),
      exchangeRate: exchangeRateDecimal.toString(),
      vTokensToBurn: vTokensToBurn.toString()
    });

    // Task 10.1.8: Execute withdraw transaction via TransactionManager.executeWithdraw()
    let transactionHash;
    try {
      transactionHash = await this.txManager.executeWithdraw(
        position.pool_address,
        position.collateral_asset,
        amountDecimal.toString(),
        walletAddress
      );
      console.log('Withdraw transaction submitted', { transactionHash });
    } catch (error) {
      throw new VesuError(
        ErrorCodes.TRANSACTION_FAILED,
        `Failed to execute withdraw transaction: ${error.message}`,
        { positionId, amount: amountDecimal.toString(), walletAddress }
      );
    }

    // Task 10.1.9: Update VesuPosition collateral_amount and vtoken_balance in database
    const currentVTokenBalance = new Decimal(position.vtoken_balance || 0);
    const newVTokenBalance = Decimal.max(currentVTokenBalance.sub(vTokensToBurn), new Decimal(0));

    await this._withDatabaseErrorHandling(async () => {
      await position.update({
        collateral_amount: newCollateralAmount.toString(),
        vtoken_balance: newVTokenBalance.toString(),
        health_factor: newHealthFactor ? newHealthFactor.toString() : null,
        last_updated: new Date()
      });
    });

    console.log('Updated position after withdrawal', {
      positionId: position.id,
      newCollateralAmount: newCollateralAmount.toString(),
      newVTokenBalance: newVTokenBalance.toString(),
      healthFactor: newHealthFactor ? newHealthFactor.toString() : null
    });

    // Task 10.1.10: Create VesuTransaction record with type='withdraw' and status='pending'
    const transaction = await this._withDatabaseErrorHandling(async () => {
      return await VesuTransaction.create({
        position_id: position.id,
        user_id: position.user_id,
        transaction_hash: transactionHash,
        type: 'withdraw',
        asset: position.collateral_asset,
        amount: amountDecimal.toString(),
        status: 'pending',
        timestamp: new Date()
      });
    });

    console.log('Created withdraw transaction record', {
      transactionId: transaction.id,
      transactionHash: transactionHash
    });

    // Return withdraw operation result
    return {
      success: true,
      transactionHash: transactionHash,
      withdrawnAmount: amountDecimal.toString(),
      vTokensBurned: vTokensToBurn.toString(),
      newHealthFactor: newHealthFactor ? newHealthFactor.toString() : null,
      position: {
        id: position.id,
        collateralAmount: newCollateralAmount.toString(),
        vTokenBalance: newVTokenBalance.toString(),
        debtAmount: position.debt_amount,
        healthFactor: newHealthFactor ? newHealthFactor.toString() : null
      },
      transaction: {
        id: transaction.id,
        status: transaction.status
      }
    };
  }

  // ============================================================================
  // POSITION MANAGEMENT OPERATIONS
  // ============================================================================

  /**
   * Get detailed position information with calculated metrics
   * Task 11.1.1: Implement getPosition(positionId) method
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Position with calculated metrics (HF, LTV, max borrowable, max withdrawable)
   */
  async getPosition(positionId) {
    console.log('VesuService.getPosition called', { positionId });

    if (!positionId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'positionId is required',
        { positionId }
      );
    }

    // Fetch position from database
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Get pool information
    const pool = await this.validatePool(position.pool_address);

    // Fetch current prices
    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices([position.collateral_asset, position.debt_asset]);
    });

    // Get current amounts
    const collateralAmount = new Decimal(position.collateral_amount || 0);
    const debtAmount = new Decimal(position.debt_amount || 0);
    const vTokenBalance = new Decimal(position.vtoken_balance || 0);

    // Calculate collateral value in USD
    const collateralPrice = new Decimal(prices[position.collateral_asset]);
    const collateralValueUSD = collateralAmount.mul(collateralPrice);

    // Calculate debt value in USD
    const debtPrice = new Decimal(prices[position.debt_asset]);
    const debtValueUSD = debtAmount.mul(debtPrice);

    // Calculate health factor
    const healthFactor = this.calculateHealthFactor(position, prices);

    // Calculate LTV
    const ltv = this.calculateLTV(position, prices);

    // Calculate max borrowable
    let maxBorrowable = new Decimal(0);
    if (!collateralAmount.isZero()) {
      const maxLTV = new Decimal(pool.max_ltv);
      const maxTotalBorrowable = this.calculateMaxBorrowable(
        collateralAmount,
        collateralPrice,
        debtPrice,
        maxLTV
      );
      maxBorrowable = Decimal.max(maxTotalBorrowable.sub(debtAmount), new Decimal(0));

      // Limit by pool liquidity
      const totalSupply = new Decimal(pool.total_supply || 0);
      const totalBorrow = new Decimal(pool.total_borrow || 0);
      const availableLiquidity = totalSupply.sub(totalBorrow);
      maxBorrowable = Decimal.min(maxBorrowable, availableLiquidity);
    }

    // Calculate max withdrawable
    const maxWithdrawable = this.calculateMaxWithdrawable(position, prices);

    console.log('Position fetched with metrics', {
      positionId: position.id,
      collateralAmount: collateralAmount.toString(),
      debtAmount: debtAmount.toString(),
      healthFactor: healthFactor ? healthFactor.toString() : 'infinite',
      ltv: ltv.toString(),
      maxBorrowable: maxBorrowable.toString(),
      maxWithdrawable: maxWithdrawable.toString()
    });

    return {
      position: {
        id: position.id,
        userId: position.user_id,
        poolAddress: position.pool_address,
        collateralAsset: position.collateral_asset,
        collateralAmount: collateralAmount.toString(),
        collateralValueUSD: collateralValueUSD.toString(),
        debtAsset: position.debt_asset,
        debtAmount: debtAmount.toString(),
        debtValueUSD: debtValueUSD.toString(),
        healthFactor: healthFactor ? healthFactor.toString() : null,
        ltv: ltv.toString(),
        maxBorrowable: maxBorrowable.toString(),
        maxWithdrawable: maxWithdrawable.toString(),
        vTokenBalance: vTokenBalance.toString(),
        status: position.status,
        createdAt: position.created_at,
        lastUpdated: position.last_updated
      },
      prices: {
        [position.collateral_asset]: collateralPrice.toString(),
        [position.debt_asset]: debtPrice.toString()
      }
    };
  }

  /**
   * Get all positions for a user with optional status filter and pagination
   * Task 11.1.2: Implement getUserPositions(userId, status) method
   * 
   * @param {string} userId - User ID
   * @param {string} status - Optional status filter ('active', 'liquidated', 'closed')
   * @param {Object} options - Pagination options { limit, offset }
   * @returns {Promise<Object>} User positions with pagination info
   */
  async getUserPositions(userId, status = null, options = {}) {
    console.log('VesuService.getUserPositions called', { userId, status, options });

    if (!userId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'userId is required',
        { userId }
      );
    }

    // Set default pagination
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    // Build query conditions
    const whereConditions = { user_id: userId };
    if (status) {
      whereConditions.status = status;
    }

    // Fetch positions from database with pagination
    const result = await this._withDatabaseErrorHandling(async () => {
      return await VesuPosition.findAndCountAll({
        where: whereConditions,
        limit: limit,
        offset: offset,
        order: [['created_at', 'DESC']]
      });
    });

    const positions = result.rows;
    const totalCount = result.count;

    // If no positions found, return empty result
    if (positions.length === 0) {
      return {
        positions: [],
        pagination: {
          total: 0,
          limit: limit,
          offset: offset,
          hasMore: false
        }
      };
    }

    // Fetch prices for all unique assets
    const uniqueAssets = new Set();
    positions.forEach(pos => {
      uniqueAssets.add(pos.collateral_asset);
      uniqueAssets.add(pos.debt_asset);
    });

    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices(Array.from(uniqueAssets));
    });

    // Calculate metrics for each position
    const positionsWithMetrics = positions.map(position => {
      const collateralAmount = new Decimal(position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debt_amount || 0);
      const vTokenBalance = new Decimal(position.vtoken_balance || 0);

      // Calculate values
      const collateralPrice = new Decimal(prices[position.collateral_asset]);
      const debtPrice = new Decimal(prices[position.debt_asset]);
      const collateralValueUSD = collateralAmount.mul(collateralPrice);
      const debtValueUSD = debtAmount.mul(debtPrice);

      // Calculate health factor
      const healthFactor = this.calculateHealthFactor(position, prices);

      // Calculate LTV
      const ltv = this.calculateLTV(position, prices);

      return {
        id: position.id,
        poolAddress: position.pool_address,
        collateralAsset: position.collateral_asset,
        collateralAmount: collateralAmount.toString(),
        collateralValueUSD: collateralValueUSD.toString(),
        debtAsset: position.debt_asset,
        debtAmount: debtAmount.toString(),
        debtValueUSD: debtValueUSD.toString(),
        healthFactor: healthFactor ? healthFactor.toString() : null,
        ltv: ltv.toString(),
        vTokenBalance: vTokenBalance.toString(),
        status: position.status,
        createdAt: position.created_at,
        lastUpdated: position.last_updated
      };
    });

    console.log('User positions fetched', {
      userId: userId,
      count: positionsWithMetrics.length,
      total: totalCount
    });

    return {
      positions: positionsWithMetrics,
      pagination: {
        total: totalCount,
        limit: limit,
        offset: offset,
        hasMore: offset + positions.length < totalCount
      }
    };
  }

  /**
   * Update position health factor using latest prices
   * Task 11.1.3: Implement updatePositionHealth(positionId) method
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Updated position health metrics
   */
  async updatePositionHealth(positionId) {
    console.log('VesuService.updatePositionHealth called', { positionId });

    if (!positionId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'positionId is required',
        { positionId }
      );
    }

    // Fetch position from database
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Fetch latest prices
    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices([position.collateral_asset, position.debt_asset]);
    });

    // Recalculate health factor with latest prices
    const healthFactor = this.calculateHealthFactor(position, prices);

    // Recalculate LTV
    const ltv = this.calculateLTV(position, prices);

    // Update position in database
    await this._withDatabaseErrorHandling(async () => {
      await position.update({
        health_factor: healthFactor ? healthFactor.toString() : null,
        last_updated: new Date()
      });
    });

    console.log('Position health updated', {
      positionId: position.id,
      healthFactor: healthFactor ? healthFactor.toString() : 'infinite',
      ltv: ltv.toString()
    });

    return {
      positionId: position.id,
      healthFactor: healthFactor ? healthFactor.toString() : null,
      ltv: ltv.toString(),
      collateralAmount: position.collateral_amount,
      debtAmount: position.debt_amount,
      prices: {
        [position.collateral_asset]: prices[position.collateral_asset].toString(),
        [position.debt_asset]: prices[position.debt_asset].toString()
      },
      lastUpdated: position.last_updated
    };
  }

  /**
   * Sync position data from blockchain contract state
   * Task 11.1.4: Implement syncPositionFromChain(positionId, walletAddress) method
   * 
   * @param {string} positionId - Position ID
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Updated position data
   */
  async syncPositionFromChain(positionId, walletAddress) {
    console.log('VesuService.syncPositionFromChain called', { positionId, walletAddress });

    if (!positionId) {
      throw new VesuError(
        ErrorCodes.INVALID_ADDRESS,
        'positionId is required',
        { positionId }
      );
    }

    this.validateAddress(walletAddress, 'walletAddress');

    // Fetch position from database
    const position = await this._withDatabaseErrorHandling(async () => {
      const pos = await VesuPosition.findByPk(positionId);
      if (!pos) {
        throw new Error(`Position not found: ${positionId}`);
      }
      return pos;
    });

    // Fetch vToken balance from contract
    const vTokenBalance = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenBalance(position.pool_address, walletAddress);
    });

    const vTokenBalanceDecimal = new Decimal(vTokenBalance);

    // Get current exchange rate to calculate underlying collateral value
    const exchangeRate = await this._withContractErrorHandling(async () => {
      return await this.contracts.getVTokenExchangeRateForPool(
        position.pool_address,
        position.collateral_asset
      );
    });

    const exchangeRateDecimal = new Decimal(exchangeRate);

    // Calculate underlying collateral amount
    const underlyingCollateral = this.calculateUnderlyingValue(vTokenBalanceDecimal, exchangeRateDecimal);

    // In a full implementation, we would also fetch debt amount from contract
    // For now, we'll keep the existing debt amount
    // TODO: Implement contract call to get actual debt with accrued interest
    // const actualDebt = await this.contracts.getPositionDebt(position.pool_address, walletAddress);

    // Fetch latest prices for health factor calculation
    const prices = await this._withOracleErrorHandling(async () => {
      return await this.oracle.getPrices([position.collateral_asset, position.debt_asset]);
    });

    // Recalculate health factor with updated collateral
    const positionForCalc = {
      collateralAsset: position.collateral_asset,
      debtAsset: position.debt_asset,
      collateralAmount: underlyingCollateral.toString(),
      debtAmount: position.debt_amount
    };

    const healthFactor = this.calculateHealthFactor(positionForCalc, prices);

    // Update position in database
    await this._withDatabaseErrorHandling(async () => {
      await position.update({
        vtoken_balance: vTokenBalanceDecimal.toString(),
        collateral_amount: underlyingCollateral.toString(),
        health_factor: healthFactor ? healthFactor.toString() : null,
        last_updated: new Date()
      });
    });

    console.log('Position synced from chain', {
      positionId: position.id,
      vTokenBalance: vTokenBalanceDecimal.toString(),
      collateralAmount: underlyingCollateral.toString(),
      exchangeRate: exchangeRateDecimal.toString(),
      healthFactor: healthFactor ? healthFactor.toString() : 'infinite'
    });

    return {
      positionId: position.id,
      vTokenBalance: vTokenBalanceDecimal.toString(),
      collateralAmount: underlyingCollateral.toString(),
      debtAmount: position.debt_amount,
      healthFactor: healthFactor ? healthFactor.toString() : null,
      exchangeRate: exchangeRateDecimal.toString(),
      lastUpdated: position.last_updated
    };
  }
}

module.exports = {
  VesuService,
  VesuError,
  ErrorCodes,
};
