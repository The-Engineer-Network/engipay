/**
 * DeFi Analytics Service
 * 
 * Provides comprehensive analytics for DeFi positions and protocols
 * Tracks performance, risk metrics, and portfolio insights
 */

const Decimal = require('decimal.js');
const VesuPosition = require('../models/VesuPosition');
const VesuPool = require('../models/VesuPool');
const VesuTransaction = require('../models/VesuTransaction');
const Portfolio = require('../models/Portfolio');
const YieldTrackingService = require('./YieldTrackingService');
const { PragmaOracleService } = require('./PragmaOracleService');
const { Op } = require('sequelize');

/**
 * DeFiAnalyticsService
 * 
 * Aggregates and analyzes DeFi data across protocols
 */
class DeFiAnalyticsService {
  constructor() {
    this.yieldTracker = new YieldTrackingService();
    this.oracle = new PragmaOracleService();
    
    // Set precision for decimal calculations
    Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });
    
    console.log('DeFiAnalyticsService initialized');
  }

  /**
   * Get comprehensive DeFi portfolio analytics for a user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Portfolio analytics
   */
  async getPortfolioAnalytics(userId) {
    try {
      console.log('Getting portfolio analytics for user:', userId);

      // Get all active positions
      const positions = await VesuPosition.findAll({
        where: {
          user_id: userId,
          status: 'active'
        }
      });

      if (positions.length === 0) {
        return {
          totalValueLocked: '0',
          totalDebt: '0',
          netValue: '0',
          totalYieldEarned: '0',
          averageAPY: '0',
          positionCount: 0,
          healthScore: 100,
          riskLevel: 'none',
          positions: []
        };
      }

      // Get prices for all assets
      const assets = new Set();
      positions.forEach(pos => {
        assets.add(pos.collateral_asset);
        assets.add(pos.debt_asset);
      });

      const prices = {};
      for (const asset of assets) {
        try {
          const price = await this.oracle.getPrice(asset);
          prices[asset] = price;
        } catch (error) {
          console.warn(`Failed to get price for ${asset}:`, error.message);
          prices[asset] = 0;
        }
      }

      // Calculate metrics for each position
      let totalCollateralValue = new Decimal(0);
      let totalDebtValue = new Decimal(0);
      let totalYieldEarned = new Decimal(0);
      let weightedAPY = new Decimal(0);
      let minHealthFactor = null;

      const positionAnalytics = [];

      for (const position of positions) {
        // Calculate position values
        const collateralAmount = new Decimal(position.collateral_amount || 0);
        const debtAmount = new Decimal(position.debt_amount || 0);
        const collateralPrice = new Decimal(prices[position.collateral_asset] || 0);
        const debtPrice = new Decimal(prices[position.debt_asset] || 0);

        const collateralValue = collateralAmount.mul(collateralPrice);
        const debtValue = debtAmount.mul(debtPrice);
        const netValue = collateralValue.sub(debtValue);

        totalCollateralValue = totalCollateralValue.add(collateralValue);
        totalDebtValue = totalDebtValue.add(debtValue);

        // Get yield data
        const yieldData = await this.yieldTracker.getPositionYield(position.id);
        const positionYield = new Decimal(yieldData.totalYieldEarned || 0);
        totalYieldEarned = totalYieldEarned.add(positionYield);

        // Calculate weighted APY
        if (collateralValue.gt(0)) {
          const positionAPY = new Decimal(yieldData.currentAPY || 0);
          weightedAPY = weightedAPY.add(positionAPY.mul(collateralValue));
        }

        // Track minimum health factor
        const healthFactor = position.health_factor ? parseFloat(position.health_factor) : null;
        if (healthFactor !== null) {
          if (minHealthFactor === null || healthFactor < minHealthFactor) {
            minHealthFactor = healthFactor;
          }
        }

        positionAnalytics.push({
          positionId: position.id,
          poolAddress: position.pool_address,
          collateralAsset: position.collateral_asset,
          debtAsset: position.debt_asset,
          collateralValue: collateralValue.toString(),
          debtValue: debtValue.toString(),
          netValue: netValue.toString(),
          healthFactor: position.health_factor,
          yieldEarned: positionYield.toString(),
          currentAPY: yieldData.currentAPY,
          status: position.status
        });
      }

      // Calculate average APY
      const averageAPY = totalCollateralValue.gt(0)
        ? weightedAPY.div(totalCollateralValue)
        : new Decimal(0);

      // Calculate overall health score
      const healthScore = this.calculateHealthScore(minHealthFactor, totalCollateralValue, totalDebtValue);
      const riskLevel = this.determineRiskLevel(minHealthFactor);

      return {
        totalValueLocked: totalCollateralValue.toString(),
        totalDebt: totalDebtValue.toString(),
        netValue: totalCollateralValue.sub(totalDebtValue).toString(),
        totalYieldEarned: totalYieldEarned.toString(),
        averageAPY: averageAPY.toString(),
        positionCount: positions.length,
        healthScore,
        riskLevel,
        minHealthFactor,
        positions: positionAnalytics
      };
    } catch (error) {
      console.error('Error getting portfolio analytics:', error);
      throw error;
    }
  }

  /**
   * Get protocol-wide analytics
   * 
   * @returns {Promise<Object>} Protocol analytics
   */
  async getProtocolAnalytics() {
    try {
      console.log('Getting protocol-wide analytics');

      // Get all active pools
      const pools = await VesuPool.findAll({
        where: { is_active: true }
      });

      // Get all active positions
      const positions = await VesuPosition.findAll({
        where: { status: 'active' }
      });

      // Calculate total TVL
      let totalTVL = new Decimal(0);
      let totalBorrowed = new Decimal(0);
      let weightedSupplyAPY = new Decimal(0);
      let weightedBorrowAPY = new Decimal(0);

      for (const pool of pools) {
        const supply = new Decimal(pool.total_supply || 0);
        const borrow = new Decimal(pool.total_borrow || 0);
        const supplyAPY = new Decimal(pool.supply_apy || 0);
        const borrowAPY = new Decimal(pool.borrow_apy || 0);

        totalTVL = totalTVL.add(supply);
        totalBorrowed = totalBorrowed.add(borrow);

        if (supply.gt(0)) {
          weightedSupplyAPY = weightedSupplyAPY.add(supplyAPY.mul(supply));
        }
        if (borrow.gt(0)) {
          weightedBorrowAPY = weightedBorrowAPY.add(borrowAPY.mul(borrow));
        }
      }

      const avgSupplyAPY = totalTVL.gt(0) ? weightedSupplyAPY.div(totalTVL) : new Decimal(0);
      const avgBorrowAPY = totalBorrowed.gt(0) ? weightedBorrowAPY.div(totalBorrowed) : new Decimal(0);

      // Get transaction statistics
      const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentTransactions = await VesuTransaction.count({
        where: {
          timestamp: { [Op.gte]: last24h }
        }
      });

      // Calculate position health distribution
      const healthDistribution = {
        healthy: 0,
        atRisk: 0,
        critical: 0,
        liquidatable: 0
      };

      for (const position of positions) {
        if (position.isLiquidatable()) {
          healthDistribution.liquidatable++;
        } else if (position.isCritical()) {
          healthDistribution.critical++;
        } else if (position.isAtRisk()) {
          healthDistribution.atRisk++;
        } else {
          healthDistribution.healthy++;
        }
      }

      return {
        totalValueLocked: totalTVL.toString(),
        totalBorrowed: totalBorrowed.toString(),
        utilizationRate: totalTVL.gt(0) ? totalBorrowed.div(totalTVL).mul(100).toString() : '0',
        averageSupplyAPY: avgSupplyAPY.toString(),
        averageBorrowAPY: avgBorrowAPY.toString(),
        totalPools: pools.length,
        totalPositions: positions.length,
        transactions24h: recentTransactions,
        healthDistribution
      };
    } catch (error) {
      console.error('Error getting protocol analytics:', error);
      throw error;
    }
  }

  /**
   * Get yield performance over time
   * 
   * @param {string} userId - User ID
   * @param {number} days - Number of days to analyze
   * @returns {Promise<Object>} Yield performance data
   */
  async getYieldPerformance(userId, days = 30) {
    try {
      console.log('Getting yield performance for user:', userId, 'days:', days);

      const positions = await VesuPosition.findAll({
        where: {
          user_id: userId,
          status: { [Op.in]: ['active', 'closed'] }
        }
      });

      if (positions.length === 0) {
        return {
          totalYield: '0',
          dailyYield: [],
          bestPerformingPosition: null,
          worstPerformingPosition: null
        };
      }

      // Get yield history for all positions
      const yieldHistory = [];
      let totalYield = new Decimal(0);
      let bestPosition = null;
      let worstPosition = null;
      let maxYield = new Decimal(-Infinity);
      let minYield = new Decimal(Infinity);

      for (const position of positions) {
        const yieldData = await this.yieldTracker.getPositionYield(position.id);
        const positionYield = new Decimal(yieldData.totalYieldEarned || 0);
        
        totalYield = totalYield.add(positionYield);

        if (positionYield.gt(maxYield)) {
          maxYield = positionYield;
          bestPosition = {
            positionId: position.id,
            poolAddress: position.pool_address,
            yieldEarned: positionYield.toString()
          };
        }

        if (positionYield.lt(minYield)) {
          minYield = positionYield;
          worstPosition = {
            positionId: position.id,
            poolAddress: position.pool_address,
            yieldEarned: positionYield.toString()
          };
        }

        // Add to history
        if (yieldData.history && yieldData.history.length > 0) {
          yieldHistory.push(...yieldData.history);
        }
      }

      // Aggregate daily yield
      const dailyYieldMap = new Map();
      yieldHistory.forEach(entry => {
        const date = new Date(entry.timestamp).toISOString().split('T')[0];
        const currentYield = dailyYieldMap.get(date) || new Decimal(0);
        dailyYieldMap.set(date, currentYield.add(new Decimal(entry.yieldEarned || 0)));
      });

      const dailyYield = Array.from(dailyYieldMap.entries())
        .map(([date, yield_]) => ({
          date,
          yield: yield_.toString()
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        totalYield: totalYield.toString(),
        dailyYield,
        bestPerformingPosition: bestPosition,
        worstPerformingPosition: worstPosition
      };
    } catch (error) {
      console.error('Error getting yield performance:', error);
      throw error;
    }
  }

  /**
   * Get risk metrics for portfolio
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Risk metrics
   */
  async getRiskMetrics(userId) {
    try {
      console.log('Getting risk metrics for user:', userId);

      const positions = await VesuPosition.findAll({
        where: {
          user_id: userId,
          status: 'active'
        }
      });

      if (positions.length === 0) {
        return {
          overallRisk: 'none',
          diversificationScore: 100,
          concentrationRisk: 'low',
          liquidationRisk: 'none',
          positionsAtRisk: 0,
          recommendations: []
        };
      }

      // Calculate risk metrics
      let positionsAtRisk = 0;
      let positionsCritical = 0;
      let positionsLiquidatable = 0;
      const assetExposure = new Map();
      const protocolExposure = new Map();

      for (const position of positions) {
        // Count risk levels
        if (position.isLiquidatable()) {
          positionsLiquidatable++;
        } else if (position.isCritical()) {
          positionsCritical++;
        } else if (position.isAtRisk()) {
          positionsAtRisk++;
        }

        // Track asset exposure
        const collateralValue = parseFloat(position.collateral_amount || 0);
        assetExposure.set(
          position.collateral_asset,
          (assetExposure.get(position.collateral_asset) || 0) + collateralValue
        );

        // Track protocol exposure
        protocolExposure.set(
          position.pool_address,
          (protocolExposure.get(position.pool_address) || 0) + collateralValue
        );
      }

      // Calculate diversification score (0-100)
      const uniqueAssets = assetExposure.size;
      const uniqueProtocols = protocolExposure.size;
      const diversificationScore = Math.min(
        100,
        (uniqueAssets * 20) + (uniqueProtocols * 10) + (positions.length * 5)
      );

      // Determine concentration risk
      const totalValue = Array.from(assetExposure.values()).reduce((sum, val) => sum + val, 0);
      const maxAssetExposure = Math.max(...Array.from(assetExposure.values()));
      const concentrationRatio = totalValue > 0 ? maxAssetExposure / totalValue : 0;
      
      const concentrationRisk = concentrationRatio > 0.7 ? 'high' :
                               concentrationRatio > 0.5 ? 'medium' : 'low';

      // Determine overall risk
      const overallRisk = positionsLiquidatable > 0 ? 'critical' :
                         positionsCritical > 0 ? 'high' :
                         positionsAtRisk > 0 ? 'medium' : 'low';

      // Generate recommendations
      const recommendations = [];
      if (positionsLiquidatable > 0) {
        recommendations.push('URGENT: Add collateral to liquidatable positions immediately');
      }
      if (positionsCritical > 0) {
        recommendations.push('Add collateral to critical positions to avoid liquidation');
      }
      if (concentrationRatio > 0.7) {
        recommendations.push('Consider diversifying across more assets to reduce concentration risk');
      }
      if (uniqueProtocols === 1) {
        recommendations.push('Consider using multiple protocols to reduce protocol risk');
      }

      return {
        overallRisk,
        diversificationScore,
        concentrationRisk,
        liquidationRisk: positionsLiquidatable > 0 ? 'high' : positionsAtRisk > 0 ? 'medium' : 'low',
        positionsAtRisk,
        positionsCritical,
        positionsLiquidatable,
        assetExposure: Object.fromEntries(assetExposure),
        protocolExposure: Object.fromEntries(protocolExposure),
        recommendations
      };
    } catch (error) {
      console.error('Error getting risk metrics:', error);
      throw error;
    }
  }

  /**
   * Calculate health score (0-100)
   * 
   * @param {number|null} minHealthFactor - Minimum health factor across positions
   * @param {Decimal} totalCollateral - Total collateral value
   * @param {Decimal} totalDebt - Total debt value
   * @returns {number} Health score
   */
  calculateHealthScore(minHealthFactor, totalCollateral, totalDebt) {
    // If no debt, perfect health
    if (totalDebt.isZero()) {
      return 100;
    }

    // If no health factor available, use collateral ratio
    if (minHealthFactor === null) {
      const collateralRatio = totalCollateral.div(totalDebt);
      if (collateralRatio.gte(2.5)) return 100;
      if (collateralRatio.gte(2.0)) return 90;
      if (collateralRatio.gte(1.5)) return 75;
      if (collateralRatio.gte(1.2)) return 50;
      if (collateralRatio.gte(1.1)) return 25;
      return 10;
    }

    // Use health factor
    if (minHealthFactor >= 2.0) return 100;
    if (minHealthFactor >= 1.5) return 85;
    if (minHealthFactor >= 1.2) return 60;
    if (minHealthFactor >= 1.1) return 35;
    if (minHealthFactor >= 1.0) return 15;
    return 0;
  }

  /**
   * Determine risk level based on health factor
   * 
   * @param {number|null} minHealthFactor - Minimum health factor
   * @returns {string} Risk level
   */
  determineRiskLevel(minHealthFactor) {
    if (minHealthFactor === null) return 'none';
    if (minHealthFactor < 1.0) return 'critical';
    if (minHealthFactor < 1.05) return 'high';
    if (minHealthFactor < 1.2) return 'medium';
    return 'low';
  }

  /**
   * Get comparative analytics across protocols
   * 
   * @returns {Promise<Object>} Protocol comparison
   */
  async getProtocolComparison() {
    try {
      console.log('Getting protocol comparison');

      const pools = await VesuPool.findAll({
        where: { is_active: true }
      });

      const protocolStats = new Map();

      for (const pool of pools) {
        const protocol = 'Vesu'; // All pools are Vesu in this implementation
        
        if (!protocolStats.has(protocol)) {
          protocolStats.set(protocol, {
            totalTVL: new Decimal(0),
            totalBorrowed: new Decimal(0),
            avgSupplyAPY: new Decimal(0),
            avgBorrowAPY: new Decimal(0),
            poolCount: 0,
            supplyAPYSum: new Decimal(0),
            borrowAPYSum: new Decimal(0)
          });
        }

        const stats = protocolStats.get(protocol);
        stats.totalTVL = stats.totalTVL.add(new Decimal(pool.total_supply || 0));
        stats.totalBorrowed = stats.totalBorrowed.add(new Decimal(pool.total_borrow || 0));
        stats.supplyAPYSum = stats.supplyAPYSum.add(new Decimal(pool.supply_apy || 0));
        stats.borrowAPYSum = stats.borrowAPYSum.add(new Decimal(pool.borrow_apy || 0));
        stats.poolCount++;
      }

      // Calculate averages
      const comparison = [];
      for (const [protocol, stats] of protocolStats.entries()) {
        comparison.push({
          protocol,
          totalTVL: stats.totalTVL.toString(),
          totalBorrowed: stats.totalBorrowed.toString(),
          utilizationRate: stats.totalTVL.gt(0) 
            ? stats.totalBorrowed.div(stats.totalTVL).mul(100).toString() 
            : '0',
          avgSupplyAPY: stats.poolCount > 0 
            ? stats.supplyAPYSum.div(stats.poolCount).toString() 
            : '0',
          avgBorrowAPY: stats.poolCount > 0 
            ? stats.borrowAPYSum.div(stats.poolCount).toString() 
            : '0',
          poolCount: stats.poolCount
        });
      }

      return comparison;
    } catch (error) {
      console.error('Error getting protocol comparison:', error);
      throw error;
    }
  }
}

// Export singleton instance
const defiAnalyticsService = new DeFiAnalyticsService();

module.exports = defiAnalyticsService;
