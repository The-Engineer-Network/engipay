/**
 * Yield Tracking Service
 * 
 * Tracks yield/interest accrual on Vesu positions over time
 * Calculates APY, total earnings, and provides yield analytics
 */

const Decimal = require('decimal.js');
const VesuPosition = require('../models/VesuPosition');
const VesuPool = require('../models/VesuPool');
const VesuTransaction = require('../models/VesuTransaction');
const { PragmaOracleService } = require('./PragmaOracleService');

// Set decimal precision
Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });

class YieldTrackingService {
  constructor(oracleService = null) {
    this.oracle = oracleService || new PragmaOracleService();
  }

  /**
   * Get position yield data (wrapper for calculateTotalYield)
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Position yield data
   */
  async getPositionYield(positionId) {
    try {
      const totalYield = await this.calculateTotalYield(positionId);
      const position = await VesuPosition.findByPk(positionId);
      
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      return {
        positionId: position.id,
        poolAddress: position.pool_address,
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset,
        totalYieldEarned: totalYield.netYield.valueUSD,
        currentAPY: totalYield.effectiveAPY,
        supplyYield: totalYield.totalSupplyYield,
        borrowCost: totalYield.totalBorrowCost,
        positionAgeDays: totalYield.positionAgeDays,
        history: []
      };
    } catch (error) {
      console.error('Error getting position yield:', error);
      throw error;
    }
  }

  /**
   * Create a yield snapshot for a position
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Snapshot data
   */
  async createYieldSnapshot(positionId) {
    try {
      const position = await VesuPosition.findByPk(positionId);
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      const yieldData = await this.calculatePositionYield(position);
      
      // In a full implementation, this would save to a snapshots table
      // For now, return the calculated data
      return {
        positionId: position.id,
        snapshotAt: new Date(),
        ...yieldData
      };
    } catch (error) {
      console.error('Error creating yield snapshot:', error);
      throw error;
    }
  }

  /**
   * Calculate yield earned on a position since last update
   * 
   * @param {Object} position - VesuPosition instance
   * @returns {Promise<Object>} Yield calculation result
   */
  async calculatePositionYield(position) {
    try {
      // Get pool information for APY
      const pool = await VesuPool.findOne({
        where: { pool_address: position.pool_address }
      });

      if (!pool) {
        throw new Error(`Pool not found: ${position.pool_address}`);
      }

      const collateralAmount = new Decimal(position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debt_amount || 0);
      const supplyAPY = new Decimal(pool.supply_apy || 0);
      const borrowAPY = new Decimal(pool.borrow_apy || 0);

      // Calculate time elapsed since last update (in years)
      const lastUpdate = position.last_updated || position.createdAt;
      const now = new Date();
      const timeElapsedMs = now - lastUpdate;
      const timeElapsedYears = new Decimal(timeElapsedMs).div(1000 * 60 * 60 * 24 * 365);

      // Calculate supply yield (earned on collateral)
      // Yield = Principal × APY × Time
      const supplyYield = collateralAmount
        .mul(supplyAPY.div(100))
        .mul(timeElapsedYears);

      // Calculate borrow cost (interest on debt)
      const borrowCost = debtAmount
        .mul(borrowAPY.div(100))
        .mul(timeElapsedYears);

      // Net yield = supply yield - borrow cost
      const netYield = supplyYield.sub(borrowCost);

      // Get asset prices for USD value
      const prices = await this.oracle.getMultiplePrices([
        position.collateral_asset,
        position.debt_asset
      ]);

      const collateralPrice = new Decimal(prices[position.collateral_asset] || 0);
      const debtPrice = new Decimal(prices[position.debt_asset] || 0);

      const supplyYieldUSD = supplyYield.mul(collateralPrice);
      const borrowCostUSD = borrowCost.mul(debtPrice);
      const netYieldUSD = supplyYieldUSD.sub(borrowCostUSD);

      return {
        positionId: position.id,
        timeElapsedDays: timeElapsedYears.mul(365).toNumber(),
        supplyYield: {
          amount: supplyYield.toString(),
          asset: position.collateral_asset,
          valueUSD: supplyYieldUSD.toString(),
          apy: supplyAPY.toString()
        },
        borrowCost: {
          amount: borrowCost.toString(),
          asset: position.debt_asset,
          valueUSD: borrowCostUSD.toString(),
          apy: borrowAPY.toString()
        },
        netYield: {
          valueUSD: netYieldUSD.toString(),
          isProfit: netYield.gt(0)
        },
        calculatedAt: now
      };
    } catch (error) {
      console.error('Error calculating position yield:', error);
      throw error;
    }
  }

  /**
   * Calculate total yield earned on a position since inception
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Total yield calculation
   */
  async calculateTotalYield(positionId) {
    try {
      const position = await VesuPosition.findByPk(positionId);
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      // Get all supply and borrow transactions
      const transactions = await VesuTransaction.findAll({
        where: { position_id: positionId },
        order: [['timestamp', 'ASC']]
      });

      const pool = await VesuPool.findOne({
        where: { pool_address: position.pool_address }
      });

      if (!pool) {
        throw new Error(`Pool not found: ${position.pool_address}`);
      }

      let totalSupplyYield = new Decimal(0);
      let totalBorrowCost = new Decimal(0);

      // Calculate yield for each period between transactions
      for (let i = 0; i < transactions.length; i++) {
        const tx = transactions[i];
        const nextTx = transactions[i + 1];
        
        const startTime = new Date(tx.timestamp);
        const endTime = nextTx ? new Date(nextTx.timestamp) : new Date();
        
        const periodYears = new Decimal(endTime - startTime).div(1000 * 60 * 60 * 24 * 365);

        // Get position state at this time (simplified - using current amounts)
        const collateral = new Decimal(position.collateral_amount || 0);
        const debt = new Decimal(position.debt_amount || 0);
        const supplyAPY = new Decimal(pool.supply_apy || 0);
        const borrowAPY = new Decimal(pool.borrow_apy || 0);

        const periodSupplyYield = collateral.mul(supplyAPY.div(100)).mul(periodYears);
        const periodBorrowCost = debt.mul(borrowAPY.div(100)).mul(periodYears);

        totalSupplyYield = totalSupplyYield.add(periodSupplyYield);
        totalBorrowCost = totalBorrowCost.add(periodBorrowCost);
      }

      const netYield = totalSupplyYield.sub(totalBorrowCost);

      // Get current prices for USD value
      const prices = await this.oracle.getMultiplePrices([
        position.collateral_asset,
        position.debt_asset
      ]);

      const collateralPrice = new Decimal(prices[position.collateral_asset] || 0);
      const debtPrice = new Decimal(prices[position.debt_asset] || 0);

      const totalSupplyYieldUSD = totalSupplyYield.mul(collateralPrice);
      const totalBorrowCostUSD = totalBorrowCost.mul(debtPrice);
      const netYieldUSD = totalSupplyYieldUSD.sub(totalBorrowCostUSD);

      // Calculate effective APY
      const positionAge = new Date() - position.createdAt;
      const positionAgeYears = new Decimal(positionAge).div(1000 * 60 * 60 * 24 * 365);
      const initialValue = new Decimal(position.collateral_amount).mul(collateralPrice);
      const effectiveAPY = positionAgeYears.gt(0) && initialValue.gt(0)
        ? netYieldUSD.div(initialValue).div(positionAgeYears).mul(100)
        : new Decimal(0);

      return {
        positionId: position.id,
        totalSupplyYield: {
          amount: totalSupplyYield.toString(),
          asset: position.collateral_asset,
          valueUSD: totalSupplyYieldUSD.toString()
        },
        totalBorrowCost: {
          amount: totalBorrowCost.toString(),
          asset: position.debt_asset,
          valueUSD: totalBorrowCostUSD.toString()
        },
        netYield: {
          valueUSD: netYieldUSD.toString(),
          isProfit: netYield.gt(0)
        },
        effectiveAPY: effectiveAPY.toString(),
        positionAgeDays: positionAgeYears.mul(365).toNumber(),
        calculatedAt: new Date()
      };
    } catch (error) {
      console.error('Error calculating total yield:', error);
      throw error;
    }
  }

  /**
   * Get yield analytics for a user across all positions
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} User yield analytics
   */
  async getUserYieldAnalytics(userId) {
    try {
      const positions = await VesuPosition.findAll({
        where: { user_id: userId, status: 'active' }
      });

      if (positions.length === 0) {
        return {
          userId,
          totalPositions: 0,
          totalYieldUSD: '0',
          averageAPY: '0',
          positions: []
        };
      }

      const positionYields = await Promise.all(
        positions.map(pos => this.calculateTotalYield(pos.id))
      );

      // Aggregate yields
      let totalYieldUSD = new Decimal(0);
      let totalAPY = new Decimal(0);

      for (const yieldData of positionYields) {
        totalYieldUSD = totalYieldUSD.add(new Decimal(yieldData.netYield.valueUSD));
        totalAPY = totalAPY.add(new Decimal(yieldData.effectiveAPY));
      }

      const averageAPY = positions.length > 0
        ? totalAPY.div(positions.length)
        : new Decimal(0);

      return {
        userId,
        totalPositions: positions.length,
        totalYieldUSD: totalYieldUSD.toString(),
        averageAPY: averageAPY.toString(),
        positions: positionYields,
        calculatedAt: new Date()
      };
    } catch (error) {
      console.error('Error getting user yield analytics:', error);
      throw error;
    }
  }

  /**
   * Calculate projected yield for a position
   * 
   * @param {string} positionId - Position ID
   * @param {number} daysAhead - Days to project (default: 30)
   * @returns {Promise<Object>} Projected yield
   */
  async projectYield(positionId, daysAhead = 30) {
    try {
      const position = await VesuPosition.findByPk(positionId);
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      const pool = await VesuPool.findOne({
        where: { pool_address: position.pool_address }
      });

      if (!pool) {
        throw new Error(`Pool not found: ${position.pool_address}`);
      }

      const collateralAmount = new Decimal(position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debt_amount || 0);
      const supplyAPY = new Decimal(pool.supply_apy || 0);
      const borrowAPY = new Decimal(pool.borrow_apy || 0);

      const projectionYears = new Decimal(daysAhead).div(365);

      // Project supply yield
      const projectedSupplyYield = collateralAmount
        .mul(supplyAPY.div(100))
        .mul(projectionYears);

      // Project borrow cost
      const projectedBorrowCost = debtAmount
        .mul(borrowAPY.div(100))
        .mul(projectionYears);

      const projectedNetYield = projectedSupplyYield.sub(projectedBorrowCost);

      // Get prices for USD value
      const prices = await this.oracle.getMultiplePrices([
        position.collateral_asset,
        position.debt_asset
      ]);

      const collateralPrice = new Decimal(prices[position.collateral_asset] || 0);
      const debtPrice = new Decimal(prices[position.debt_asset] || 0);

      const projectedSupplyYieldUSD = projectedSupplyYield.mul(collateralPrice);
      const projectedBorrowCostUSD = projectedBorrowCost.mul(debtPrice);
      const projectedNetYieldUSD = projectedSupplyYieldUSD.sub(projectedBorrowCostUSD);

      return {
        positionId: position.id,
        projectionDays: daysAhead,
        projectedSupplyYield: {
          amount: projectedSupplyYield.toString(),
          asset: position.collateral_asset,
          valueUSD: projectedSupplyYieldUSD.toString(),
          apy: supplyAPY.toString()
        },
        projectedBorrowCost: {
          amount: projectedBorrowCost.toString(),
          asset: position.debt_asset,
          valueUSD: projectedBorrowCostUSD.toString(),
          apy: borrowAPY.toString()
        },
        projectedNetYield: {
          valueUSD: projectedNetYieldUSD.toString(),
          isProfit: projectedNetYield.gt(0)
        },
        assumptions: {
          currentSupplyAPY: supplyAPY.toString(),
          currentBorrowAPY: borrowAPY.toString(),
          note: 'Projection assumes constant APY rates'
        },
        calculatedAt: new Date()
      };
    } catch (error) {
      console.error('Error projecting yield:', error);
      throw error;
    }
  }

  /**
   * Get yield history for a position (daily snapshots)
   * 
   * @param {string} positionId - Position ID
   * @param {number} days - Number of days of history (default: 30)
   * @returns {Promise<Array>} Daily yield history
   */
  async getYieldHistory(positionId, days = 30) {
    try {
      const position = await VesuPosition.findByPk(positionId);
      if (!position) {
        throw new Error(`Position not found: ${positionId}`);
      }

      // In a full implementation, this would fetch actual daily snapshots
      // For now, we'll generate estimated history based on current APY
      const pool = await VesuPool.findOne({
        where: { pool_address: position.pool_address }
      });

      if (!pool) {
        throw new Error(`Pool not found: ${position.pool_address}`);
      }

      const history = [];
      const collateralAmount = new Decimal(position.collateral_amount || 0);
      const debtAmount = new Decimal(position.debt_amount || 0);
      const supplyAPY = new Decimal(pool.supply_apy || 0);
      const borrowAPY = new Decimal(pool.borrow_apy || 0);

      const prices = await this.oracle.getMultiplePrices([
        position.collateral_asset,
        position.debt_asset
      ]);

      const collateralPrice = new Decimal(prices[position.collateral_asset] || 0);
      const debtPrice = new Decimal(prices[position.debt_asset] || 0);

      const dailySupplyYield = collateralAmount
        .mul(supplyAPY.div(100))
        .div(365);

      const dailyBorrowCost = debtAmount
        .mul(borrowAPY.div(100))
        .div(365);

      const dailyNetYield = dailySupplyYield.sub(dailyBorrowCost);
      const dailyNetYieldUSD = dailySupplyYield.mul(collateralPrice)
        .sub(dailyBorrowCost.mul(debtPrice));

      let cumulativeYield = new Decimal(0);

      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);

        cumulativeYield = cumulativeYield.add(dailyNetYieldUSD);

        history.push({
          date: date.toISOString().split('T')[0],
          dailyYieldUSD: dailyNetYieldUSD.toString(),
          cumulativeYieldUSD: cumulativeYield.toString(),
          supplyAPY: supplyAPY.toString(),
          borrowAPY: borrowAPY.toString()
        });
      }

      return {
        positionId: position.id,
        days,
        history,
        summary: {
          totalYieldUSD: cumulativeYield.toString(),
          averageDailyYieldUSD: dailyNetYieldUSD.toString(),
          currentSupplyAPY: supplyAPY.toString(),
          currentBorrowAPY: borrowAPY.toString()
        }
      };
    } catch (error) {
      console.error('Error getting yield history:', error);
      throw error;
    }
  }

  /**
   * Compare yield across multiple positions
   * 
   * @param {Array<string>} positionIds - Array of position IDs
   * @returns {Promise<Object>} Yield comparison
   */
  async comparePositionYields(positionIds) {
    try {
      const comparisons = await Promise.all(
        positionIds.map(async (id) => {
          const totalYield = await this.calculateTotalYield(id);
          const position = await VesuPosition.findByPk(id);
          
          return {
            positionId: id,
            poolAddress: position.pool_address,
            collateralAsset: position.collateral_asset,
            debtAsset: position.debt_asset,
            netYieldUSD: totalYield.netYield.valueUSD,
            effectiveAPY: totalYield.effectiveAPY,
            positionAgeDays: totalYield.positionAgeDays
          };
        })
      );

      // Sort by net yield (highest first)
      comparisons.sort((a, b) => 
        new Decimal(b.netYieldUSD).cmp(new Decimal(a.netYieldUSD))
      );

      const bestPerformer = comparisons[0];
      const worstPerformer = comparisons[comparisons.length - 1];

      return {
        positions: comparisons,
        bestPerformer,
        worstPerformer,
        totalPositions: comparisons.length,
        calculatedAt: new Date()
      };
    } catch (error) {
      console.error('Error comparing position yields:', error);
      throw error;
    }
  }
}

module.exports = YieldTrackingService;
