/**
 * Analytics Service
 * Backend Dev 4 Task - Analytics engine and reporting
 * 
 * Features:
 * - Portfolio analytics
 * - Transaction analytics
 * - DeFi yield tracking
 * - Performance metrics
 * - User activity tracking
 */

const priceService = require('./priceService');

class AnalyticsService {
  constructor() {
    // Analytics cache
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }

  /**
   * Get from cache
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  /**
   * Set cache
   */
  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Calculate portfolio analytics
   */
  async calculatePortfolioAnalytics(holdings, currency = 'usd') {
    const cacheKey = `portfolio:${JSON.stringify(holdings)}:${currency}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Get current portfolio value
    const portfolioValue = await priceService.calculatePortfolioValue(holdings, currency);
    
    // Calculate allocation percentages
    const totalValue = portfolioValue.totalValue;
    const allocations = portfolioValue.holdings.map(holding => ({
      ...holding,
      allocationPercent: (holding.value / totalValue) * 100
    }));

    // Calculate diversification score (0-100)
    const diversificationScore = this.calculateDiversificationScore(allocations);

    // Calculate risk metrics
    const riskMetrics = this.calculateRiskMetrics(allocations);

    const analytics = {
      totalValue,
      currency,
      holdings: allocations,
      diversificationScore,
      riskMetrics,
      timestamp: new Date().toISOString()
    };

    this.setCache(cacheKey, analytics);
    return analytics;
  }

  /**
   * Calculate diversification score
   */
  calculateDiversificationScore(allocations) {
    if (allocations.length === 0) return 0;
    if (allocations.length === 1) return 20;

    // Calculate Herfindahl-Hirschman Index (HHI)
    const hhi = allocations.reduce((sum, holding) => {
      const share = holding.allocationPercent / 100;
      return sum + (share * share);
    }, 0);

    // Convert HHI to score (0-100)
    // HHI ranges from 1/n to 1, where n is number of holdings
    // Lower HHI = better diversification
    const maxHHI = 1;
    const minHHI = 1 / allocations.length;
    const normalizedHHI = (hhi - minHHI) / (maxHHI - minHHI);
    const score = Math.round((1 - normalizedHHI) * 100);

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Calculate risk metrics
   */
  calculateRiskMetrics(allocations) {
    // Calculate volatility based on 24h changes
    const changes = allocations.map(h => h.change24h || 0);
    const avgChange = changes.reduce((sum, c) => sum + c, 0) / changes.length;
    const variance = changes.reduce((sum, c) => sum + Math.pow(c - avgChange, 2), 0) / changes.length;
    const volatility = Math.sqrt(variance);

    // Risk level classification
    let riskLevel = 'low';
    if (volatility > 10) riskLevel = 'high';
    else if (volatility > 5) riskLevel = 'medium';

    return {
      volatility: Math.round(volatility * 100) / 100,
      riskLevel,
      avgChange24h: Math.round(avgChange * 100) / 100
    };
  }

  /**
   * Calculate portfolio performance over time
   */
  async calculatePortfolioPerformance(holdings, currency = 'usd', days = 30) {
    const performance = {
      current: 0,
      historical: [],
      change: 0,
      changePercent: 0
    };

    // Get current value
    const currentValue = await priceService.calculatePortfolioValue(holdings, currency);
    performance.current = currentValue.totalValue;

    // Get historical data for each holding
    const historicalPromises = holdings.map(async (holding) => {
      const coinId = priceService.getCoinId(holding.symbol);
      const historical = await priceService.getHistoricalPrice(coinId, currency, days);
      return {
        symbol: holding.symbol,
        amount: holding.amount,
        prices: historical.prices
      };
    });

    const historicalData = await Promise.all(historicalPromises);

    // Calculate portfolio value at each time point
    const timePoints = historicalData[0].prices.length;
    for (let i = 0; i < timePoints; i++) {
      let totalValue = 0;
      const timestamp = historicalData[0].prices[i][0];

      for (const holding of historicalData) {
        if (holding.prices[i]) {
          totalValue += holding.amount * holding.prices[i][1];
        }
      }

      performance.historical.push({
        timestamp,
        value: totalValue
      });
    }

    // Calculate change
    if (performance.historical.length > 0) {
      const firstValue = performance.historical[0].value;
      performance.change = performance.current - firstValue;
      performance.changePercent = (performance.change / firstValue) * 100;
    }

    return performance;
  }

  /**
   * Calculate transaction analytics
   */
  calculateTransactionAnalytics(transactions) {
    const analytics = {
      total: transactions.length,
      byType: {},
      byStatus: {},
      totalVolume: 0,
      avgTransactionSize: 0,
      successRate: 0,
      timeline: []
    };

    // Group by type
    transactions.forEach(tx => {
      analytics.byType[tx.type] = (analytics.byType[tx.type] || 0) + 1;
      analytics.byStatus[tx.status] = (analytics.byStatus[tx.status] || 0) + 1;
      
      if (tx.amount) {
        analytics.totalVolume += tx.amount;
      }
    });

    // Calculate averages
    if (transactions.length > 0) {
      analytics.avgTransactionSize = analytics.totalVolume / transactions.length;
      const successCount = analytics.byStatus['confirmed'] || 0;
      analytics.successRate = (successCount / transactions.length) * 100;
    }

    // Create timeline (group by day)
    const timelineMap = new Map();
    transactions.forEach(tx => {
      const date = new Date(tx.timestamp).toISOString().split('T')[0];
      if (!timelineMap.has(date)) {
        timelineMap.set(date, { date, count: 0, volume: 0 });
      }
      const day = timelineMap.get(date);
      day.count++;
      day.volume += tx.amount || 0;
    });

    analytics.timeline = Array.from(timelineMap.values()).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    return analytics;
  }

  /**
   * Calculate DeFi yield analytics
   */
  calculateDeFiYieldAnalytics(positions) {
    const analytics = {
      totalDeposited: 0,
      totalBorrowed: 0,
      totalYieldEarned: 0,
      avgAPY: 0,
      byProtocol: {},
      positions: []
    };

    positions.forEach(position => {
      // Aggregate totals
      analytics.totalDeposited += position.depositedAmount || 0;
      analytics.totalBorrowed += position.borrowedAmount || 0;
      analytics.totalYieldEarned += position.yieldEarned || 0;

      // Group by protocol
      if (!analytics.byProtocol[position.protocol]) {
        analytics.byProtocol[position.protocol] = {
          deposited: 0,
          borrowed: 0,
          yieldEarned: 0,
          positions: 0
        };
      }
      const protocol = analytics.byProtocol[position.protocol];
      protocol.deposited += position.depositedAmount || 0;
      protocol.borrowed += position.borrowedAmount || 0;
      protocol.yieldEarned += position.yieldEarned || 0;
      protocol.positions++;

      // Calculate position metrics
      analytics.positions.push({
        id: position.id,
        protocol: position.protocol,
        asset: position.asset,
        deposited: position.depositedAmount,
        borrowed: position.borrowedAmount,
        apy: position.apy,
        yieldEarned: position.yieldEarned,
        healthFactor: position.healthFactor
      });
    });

    // Calculate average APY
    if (positions.length > 0) {
      const totalAPY = positions.reduce((sum, p) => sum + (p.apy || 0), 0);
      analytics.avgAPY = totalAPY / positions.length;
    }

    // Calculate net position
    analytics.netPosition = analytics.totalDeposited - analytics.totalBorrowed;
    analytics.utilizationRate = analytics.totalDeposited > 0 
      ? (analytics.totalBorrowed / analytics.totalDeposited) * 100 
      : 0;

    return analytics;
  }

  /**
   * Calculate swap analytics
   */
  calculateSwapAnalytics(swaps) {
    const analytics = {
      total: swaps.length,
      completed: 0,
      failed: 0,
      pending: 0,
      totalVolumeUSD: 0,
      avgSwapSize: 0,
      successRate: 0,
      byPair: {},
      timeline: []
    };

    swaps.forEach(swap => {
      // Count by status
      if (swap.status === 'completed') analytics.completed++;
      else if (swap.status === 'failed') analytics.failed++;
      else analytics.pending++;

      // Calculate volume (approximate in USD)
      if (swap.fromAmountUSD) {
        analytics.totalVolumeUSD += swap.fromAmountUSD;
      }

      // Group by trading pair
      const pair = `${swap.fromCurrency}/${swap.toCurrency}`;
      if (!analytics.byPair[pair]) {
        analytics.byPair[pair] = { count: 0, volume: 0 };
      }
      analytics.byPair[pair].count++;
      analytics.byPair[pair].volume += swap.fromAmountUSD || 0;
    });

    // Calculate metrics
    if (swaps.length > 0) {
      analytics.avgSwapSize = analytics.totalVolumeUSD / swaps.length;
      analytics.successRate = (analytics.completed / swaps.length) * 100;
    }

    // Create timeline
    const timelineMap = new Map();
    swaps.forEach(swap => {
      const date = new Date(swap.timestamp).toISOString().split('T')[0];
      if (!timelineMap.has(date)) {
        timelineMap.set(date, { date, count: 0, volume: 0 });
      }
      const day = timelineMap.get(date);
      day.count++;
      day.volume += swap.fromAmountUSD || 0;
    });

    analytics.timeline = Array.from(timelineMap.values()).sort((a, b) => 
      new Date(a.date) - new Date(b.date)
    );

    return analytics;
  }

  /**
   * Generate user activity report
   */
  generateUserActivityReport(userId, transactions, swaps, defiPositions) {
    const report = {
      userId,
      generatedAt: new Date().toISOString(),
      transactions: this.calculateTransactionAnalytics(transactions),
      swaps: this.calculateSwapAnalytics(swaps),
      defi: this.calculateDeFiYieldAnalytics(defiPositions),
      summary: {}
    };

    // Generate summary
    report.summary = {
      totalTransactions: report.transactions.total,
      totalSwaps: report.swaps.total,
      totalDeFiPositions: defiPositions.length,
      transactionSuccessRate: report.transactions.successRate,
      swapSuccessRate: report.swaps.successRate,
      totalYieldEarned: report.defi.totalYieldEarned,
      activityScore: this.calculateActivityScore(report)
    };

    return report;
  }

  /**
   * Calculate user activity score (0-100)
   */
  calculateActivityScore(report) {
    let score = 0;

    // Transaction activity (0-30 points)
    const txScore = Math.min(30, report.transactions.total * 2);
    score += txScore;

    // Swap activity (0-30 points)
    const swapScore = Math.min(30, report.swaps.total * 3);
    score += swapScore;

    // DeFi activity (0-40 points)
    const defiScore = Math.min(40, report.defi.positions.length * 5);
    score += defiScore;

    return Math.round(score);
  }

  /**
   * Calculate platform-wide analytics
   */
  calculatePlatformAnalytics(allUsers, allTransactions, allSwaps, allDefiPositions) {
    return {
      users: {
        total: allUsers.length,
        active: allUsers.filter(u => u.lastActive > Date.now() - 30 * 24 * 60 * 60 * 1000).length,
        new: allUsers.filter(u => u.createdAt > Date.now() - 7 * 24 * 60 * 60 * 1000).length
      },
      transactions: this.calculateTransactionAnalytics(allTransactions),
      swaps: this.calculateSwapAnalytics(allSwaps),
      defi: this.calculateDeFiYieldAnalytics(allDefiPositions),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

// Singleton instance
const analyticsService = new AnalyticsService();

module.exports = analyticsService;
