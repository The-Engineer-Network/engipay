const Decimal = require('decimal.js');
const { VesuService } = require('./VesuService');
const TransactionManager = require('./TransactionManager');
const VesuPosition = require('../models/VesuPosition');
const VesuLiquidation = require('../models/VesuLiquidation');
const VesuPool = require('../models/VesuPool');
const { getVesuConfig } = require('../config/vesu.config');

/**
 * LiquidationEngine
 * 
 * Service for identifying and executing liquidations on undercollateralized positions.
 * 
 * Task 13.1: Create LiquidationEngine class
 */
class LiquidationEngine {
  /**
   * Initialize LiquidationEngine with dependencies
   * Task 13.1.1: Initialize with VesuService and TransactionManager dependencies
   * 
   * @param {VesuService} vesuService - VesuService instance for position operations
   * @param {TransactionManager} transactionManager - TransactionManager instance for executing liquidations
   */
  constructor(vesuService = null, transactionManager = null) {
    // Initialize VesuService dependency
    this.vesuService = vesuService || new VesuService();
    
    // Initialize TransactionManager dependency
    this.txManager = transactionManager || new TransactionManager(this.vesuService.contracts.provider);
    
    // Load configuration
    this.config = getVesuConfig();
    
    // Set precision for decimal calculations
    Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });
    
    console.log('LiquidationEngine initialized');
  }

  /**
   * Find all liquidatable positions and calculate profitability
   * Task 13.1.2: Implement findLiquidatablePositions() method to query positions with health_factor < 1.0
   * 
   * @returns {Promise<Array>} Array of liquidation opportunities sorted by profit potential
   */
  async findLiquidatablePositions() {
    console.log('LiquidationEngine.findLiquidatablePositions called');

    try {
      // Query positions with health_factor < 1.0 from database
      const liquidatablePositions = await VesuPosition.findAll({
        where: {
          status: 'active',
          health_factor: {
            [require('sequelize').Op.lt]: 1.0,
            [require('sequelize').Op.ne]: null
          }
        },
        order: [['health_factor', 'ASC']]
      });

      console.log(`Found ${liquidatablePositions.length} liquidatable positions`);

      if (liquidatablePositions.length === 0) {
        return [];
      }

      // Fetch prices for all unique assets
      const uniqueAssets = new Set();
      liquidatablePositions.forEach(pos => {
        uniqueAssets.add(pos.collateral_asset);
        uniqueAssets.add(pos.debt_asset);
      });

      const prices = await this.vesuService.oracle.getPrices(Array.from(uniqueAssets));

      // Calculate profitability for each opportunity
      const opportunities = [];

      for (const position of liquidatablePositions) {
        try {
          // Get pool configuration for liquidation bonus
          const pool = await VesuPool.findOne({
            where: { pool_address: position.pool_address }
          });

          if (!pool) {
            console.warn(`Pool not found for position ${position.id}`);
            continue;
          }

          // Task 13.1.3: Calculate liquidation profitability
          const profitability = this.calculateLiquidationProfitability(
            position,
            pool,
            prices
          );

          opportunities.push({
            positionId: position.id,
            userId: position.user_id,
            poolAddress: position.pool_address,
            collateralAsset: position.collateral_asset,
            debtAsset: position.debt_asset,
            collateralAmount: position.collateral_amount,
            debtAmount: position.debt_amount,
            healthFactor: position.health_factor,
            collateralValue: profitability.collateralValue,
            debtValue: profitability.debtValue,
            liquidationBonus: profitability.liquidationBonus,
            potentialProfit: profitability.potentialProfit,
            collateralPrice: prices[position.collateral_asset],
            debtPrice: prices[position.debt_asset]
          });
        } catch (error) {
          console.error(`Error calculating profitability for position ${position.id}:`, error);
        }
      }

      // Task 13.1.4: Sort opportunities by profit potential (descending order)
      opportunities.sort((a, b) => {
        const profitA = parseFloat(a.potentialProfit);
        const profitB = parseFloat(b.potentialProfit);
        return profitB - profitA;
      });

      console.log(`Calculated profitability for ${opportunities.length} opportunities`);

      return opportunities;
    } catch (error) {
      console.error('Error finding liquidatable positions:', error);
      throw new Error(`Failed to find liquidatable positions: ${error.message}`);
    }
  }

  /**
   * Calculate liquidation profitability for a position
   * Task 13.1.3: Calculate liquidation profitability for each opportunity
   * 
   * @param {Object} position - VesuPosition instance
   * @param {Object} pool - VesuPool instance
   * @param {Object} prices - Asset prices
   * @returns {Object} Profitability calculation
   */
  calculateLiquidationProfitability(position, pool, prices) {
    try {
      const collateralAmount = new Decimal(position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debt_amount || 0);
      const collateralPrice = new Decimal(prices[position.collateral_asset]);
      const debtPrice = new Decimal(prices[position.debt_asset]);
      const liquidationBonus = new Decimal(pool.liquidation_bonus || 0.05);

      // Calculate collateral value in USD
      const collateralValue = collateralAmount.mul(collateralPrice);

      // Calculate debt value in USD
      const debtValue = debtAmount.mul(debtPrice);

      // Calculate liquidation bonus value
      // Liquidation bonus is applied to the collateral seized
      // Profit = (collateral value * liquidation bonus) - transaction costs
      // For simplicity, we'll calculate: collateral value * liquidation bonus
      const bonusValue = collateralValue.mul(liquidationBonus);

      // Potential profit is the bonus value
      // In reality, this would be: (collateral seized * price * (1 + bonus)) - debt repaid - gas costs
      // But for ranking purposes, bonus value is a good proxy
      const potentialProfit = bonusValue;

      return {
        collateralValue: collateralValue.toString(),
        debtValue: debtValue.toString(),
        liquidationBonus: liquidationBonus.toString(),
        bonusValue: bonusValue.toString(),
        potentialProfit: potentialProfit.toString()
      };
    } catch (error) {
      throw new Error(`Failed to calculate liquidation profitability: ${error.message}`);
    }
  }

  /**
   * Execute liquidation on an undercollateralized position
   * Task 13.2: Implement liquidation execution
   * 
   * @param {string} positionId - Position ID to liquidate
   * @param {string} debtToCover - Amount of debt to cover (optional, defaults to full liquidation)
   * @param {string} liquidatorAddress - Address of the liquidator
   * @returns {Promise<Object>} Liquidation result
   */
  async executeLiquidation(positionId, debtToCover = null, liquidatorAddress) {
    console.log('LiquidationEngine.executeLiquidation called', {
      positionId,
      debtToCover,
      liquidatorAddress
    });

    try {
      // Validate liquidator address
      this.vesuService.validateAddress(liquidatorAddress, 'liquidatorAddress');

      // Fetch position from database
      const position = await VesuPosition.findByPk(positionId);
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      // Task 13.2.1: Validate position is liquidatable (health factor < 1.0) before execution
      if (position.status !== 'active') {
        throw new Error(`Position is not active: ${position.status}`);
      }

      const healthFactor = position.health_factor ? parseFloat(position.health_factor) : null;
      if (healthFactor === null || healthFactor >= 1.0) {
        throw new Error(`Position is not liquidatable. Health factor: ${healthFactor}`);
      }

      console.log('Position is liquidatable', {
        positionId: position.id,
        healthFactor: healthFactor
      });

      // Get pool configuration
      const pool = await VesuPool.findOne({
        where: { pool_address: position.pool_address }
      });

      if (!pool) {
        throw new Error(`Pool not found: ${position.pool_address}`);
      }

      // Fetch current prices
      const prices = await this.vesuService.oracle.getPrices([
        position.collateral_asset,
        position.debt_asset
      ]);

      const collateralPrice = new Decimal(prices[position.collateral_asset]);
      const debtPrice = new Decimal(prices[position.debt_asset]);

      // Task 13.2.2: Calculate debt to cover based on position (full or partial liquidation)
      const totalDebt = new Decimal(position.debt_amount || 0);
      let debtToCoverDecimal;

      if (debtToCover) {
        // Partial liquidation
        debtToCoverDecimal = new Decimal(debtToCover);
        
        // Validate debt to cover doesn't exceed total debt
        if (debtToCoverDecimal.gt(totalDebt)) {
          throw new Error(`Debt to cover exceeds total debt. Total: ${totalDebt.toString()}, Requested: ${debtToCoverDecimal.toString()}`);
        }
      } else {
        // Full liquidation - cover all debt
        debtToCoverDecimal = totalDebt;
      }

      console.log('Debt to cover calculated', {
        totalDebt: totalDebt.toString(),
        debtToCover: debtToCoverDecimal.toString(),
        isFullLiquidation: debtToCoverDecimal.eq(totalDebt)
      });

      // Task 13.2.3: Calculate collateral to seize with liquidation bonus
      // Formula: collateralSeized = (debtCovered / collateralPrice) * (1 + liquidationBonus)
      const liquidationBonus = new Decimal(pool.liquidation_bonus || 0.05);
      
      // Calculate debt value in collateral asset terms
      const debtValueInCollateral = debtToCoverDecimal.mul(debtPrice).div(collateralPrice);
      
      // Apply liquidation bonus
      const collateralToSeize = debtValueInCollateral.mul(new Decimal(1).add(liquidationBonus));

      // Calculate liquidation bonus amount
      const bonusAmount = debtValueInCollateral.mul(liquidationBonus);

      console.log('Collateral to seize calculated', {
        debtToCover: debtToCoverDecimal.toString(),
        debtPrice: debtPrice.toString(),
        collateralPrice: collateralPrice.toString(),
        liquidationBonus: liquidationBonus.toString(),
        collateralToSeize: collateralToSeize.toString(),
        bonusAmount: bonusAmount.toString()
      });

      // Validate sufficient collateral exists
      const currentCollateral = new Decimal(position.collateral_amount || 0);
      if (collateralToSeize.gt(currentCollateral)) {
        throw new Error(`Insufficient collateral to seize. Available: ${currentCollateral.toString()}, Required: ${collateralToSeize.toString()}`);
      }

      // Task 13.2.4: Execute liquidation transaction via TransactionManager.executeLiquidation()
      let transactionHash;
      try {
        transactionHash = await this.txManager.executeLiquidation(
          position.pool_address,
          positionId,
          debtToCoverDecimal.toString(),
          liquidatorAddress
        );
        console.log('Liquidation transaction submitted', { transactionHash });
      } catch (error) {
        throw new Error(`Failed to execute liquidation transaction: ${error.message}`);
      }

      // Task 13.2.5: Update VesuPosition status to "liquidated" in database
      const remainingDebt = totalDebt.sub(debtToCoverDecimal);
      const remainingCollateral = currentCollateral.sub(collateralToSeize);

      // If full liquidation or remaining debt is negligible, mark as liquidated
      const isFullLiquidation = remainingDebt.lte(new Decimal(0.000001));

      await position.update({
        collateral_amount: remainingCollateral.toString(),
        debt_amount: remainingDebt.toString(),
        status: isFullLiquidation ? 'liquidated' : 'active',
        health_factor: isFullLiquidation ? null : position.health_factor,
        last_updated: new Date()
      });

      console.log('Position updated after liquidation', {
        positionId: position.id,
        status: position.status,
        remainingCollateral: remainingCollateral.toString(),
        remainingDebt: remainingDebt.toString()
      });

      // Task 13.2.6: Create VesuLiquidation record
      const liquidation = await VesuLiquidation.create({
        position_id: position.id,
        liquidator_address: liquidatorAddress,
        transaction_hash: transactionHash,
        collateral_seized: collateralToSeize.toString(),
        debt_repaid: debtToCoverDecimal.toString(),
        liquidation_bonus: bonusAmount.toString(),
        timestamp: new Date()
      });

      console.log('Liquidation record created', {
        liquidationId: liquidation.id,
        transactionHash: transactionHash
      });

      // Return liquidation result
      return {
        success: true,
        transactionHash: transactionHash,
        liquidation: {
          id: liquidation.id,
          positionId: position.id,
          collateralSeized: collateralToSeize.toString(),
          debtRepaid: debtToCoverDecimal.toString(),
          liquidationBonus: bonusAmount.toString(),
          liquidatorAddress: liquidatorAddress,
          timestamp: liquidation.timestamp
        },
        position: {
          id: position.id,
          status: position.status,
          remainingCollateral: remainingCollateral.toString(),
          remainingDebt: remainingDebt.toString()
        }
      };
    } catch (error) {
      console.error('Error executing liquidation:', error);
      throw new Error(`Failed to execute liquidation: ${error.message}`);
    }
  }
}

module.exports = LiquidationEngine;
