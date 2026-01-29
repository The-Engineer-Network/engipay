const cron = require('node-cron');
const { VesuService } = require('./VesuService');
const Notification = require('../models/Notification');
const VesuPosition = require('../models/VesuPosition');
const { getVesuConfig } = require('../config/vesu.config');
const { v4: uuidv4 } = require('uuid');

/**
 * PositionMonitor
 * 
 * Background service for monitoring Vesu lending positions and sending alerts
 * when positions are at risk of liquidation.
 * 
 * Task 12.1: Create PositionMonitor class
 */
class PositionMonitor {
  /**
   * Initialize PositionMonitor with dependencies
   * Task 12.1.1: Initialize with VesuService and notification service dependencies
   * 
   * @param {VesuService} vesuService - VesuService instance for position operations
   * @param {Object} notificationService - Notification service (using Notification model)
   */
  constructor(vesuService = null, notificationService = null) {
    // Initialize VesuService dependency
    this.vesuService = vesuService || new VesuService();
    
    // Notification service is the Notification model
    this.notificationService = notificationService || Notification;
    
    // Load configuration
    this.config = getVesuConfig();
    
    // Get monitoring configuration
    this.monitoringInterval = this.config.monitoring.interval; // Default: 60000ms (1 minute) for testnet
    this.warningThreshold = this.config.monitoring.warningThreshold; // 1.2
    this.criticalThreshold = this.config.monitoring.criticalThreshold; // 1.05
    this.liquidationThreshold = this.config.monitoring.liquidationThreshold; // 1.0
    
    // Cron job instance
    this.cronJob = null;
    
    // Monitoring state
    this.isRunning = false;
    this.lastRunTime = null;
    this.monitoringStats = {
      totalRuns: 0,
      positionsChecked: 0,
      warningsIssued: 0,
      criticalAlertsIssued: 0,
      liquidationAlertsIssued: 0,
      errors: 0
    };
    
    console.log('PositionMonitor initialized', {
      monitoringInterval: this.monitoringInterval,
      warningThreshold: this.warningThreshold,
      criticalThreshold: this.criticalThreshold,
      liquidationThreshold: this.liquidationThreshold
    });
  }

  /**
   * Start the position monitoring service
   * Task 12.1.2: Set up cron job using node-cron for periodic monitoring
   * 
   * @returns {void}
   */
  start() {
    if (this.isRunning) {
      console.log('PositionMonitor is already running');
      return;
    }

    // Convert interval from milliseconds to seconds for cron
    const intervalSeconds = Math.floor(this.monitoringInterval / 1000);
    
    // Create cron expression for the interval
    // For intervals less than 60 seconds, run every N seconds
    // For intervals >= 60 seconds, run every N minutes
    let cronExpression;
    if (intervalSeconds < 60) {
      // Run every N seconds (e.g., "*/30 * * * * *" for every 30 seconds)
      cronExpression = `*/${intervalSeconds} * * * * *`;
    } else {
      // Run every N minutes (e.g., "*/1 * * * *" for every minute)
      const intervalMinutes = Math.floor(intervalSeconds / 60);
      cronExpression = `*/${intervalMinutes} * * * *`;
    }

    console.log('Starting PositionMonitor', {
      cronExpression: cronExpression,
      intervalMs: this.monitoringInterval
    });

    // Set up cron job
    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.monitorAllPositions();
    });

    this.isRunning = true;
    console.log('PositionMonitor started successfully');

    // Run initial check immediately
    this.monitorAllPositions().catch(error => {
      console.error('Error in initial position monitoring:', error);
    });
  }

  /**
   * Stop the position monitoring service
   * 
   * @returns {void}
   */
  stop() {
    if (!this.isRunning) {
      console.log('PositionMonitor is not running');
      return;
    }

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    this.isRunning = false;
    console.log('PositionMonitor stopped', {
      stats: this.monitoringStats
    });
  }

  /**
   * Monitor all active positions for health issues
   * Task 12.1.3: Implement monitorAllPositions() method to check all active positions
   * 
   * @returns {Promise<Object>} Monitoring results
   */
  async monitorAllPositions() {
    const startTime = Date.now();
    console.log('Starting position monitoring cycle');

    try {
      // Fetch all active positions from database
      const activePositions = await VesuPosition.findAll({
        where: { status: 'active' },
        order: [['health_factor', 'ASC NULLS LAST']]
      });

      console.log(`Found ${activePositions.length} active positions to monitor`);

      if (activePositions.length === 0) {
        this.lastRunTime = new Date();
        this.monitoringStats.totalRuns++;
        return {
          success: true,
          positionsChecked: 0,
          warnings: 0,
          criticalAlerts: 0,
          liquidationAlerts: 0,
          duration: Date.now() - startTime
        };
      }

      // Track results
      let warningsIssued = 0;
      let criticalAlertsIssued = 0;
      let liquidationAlertsIssued = 0;
      let positionsChecked = 0;

      // Check each position
      for (const position of activePositions) {
        try {
          const result = await this.checkPositionHealth(position);
          positionsChecked++;

          if (result.alertIssued) {
            if (result.alertType === 'warning') {
              warningsIssued++;
            } else if (result.alertType === 'critical') {
              criticalAlertsIssued++;
            } else if (result.alertType === 'liquidation') {
              liquidationAlertsIssued++;
            }
          }
        } catch (error) {
          console.error(`Error checking position ${position.id}:`, error);
          this.monitoringStats.errors++;
        }
      }

      // Update stats
      this.lastRunTime = new Date();
      this.monitoringStats.totalRuns++;
      this.monitoringStats.positionsChecked += positionsChecked;
      this.monitoringStats.warningsIssued += warningsIssued;
      this.monitoringStats.criticalAlertsIssued += criticalAlertsIssued;
      this.monitoringStats.liquidationAlertsIssued += liquidationAlertsIssued;

      const duration = Date.now() - startTime;
      console.log('Position monitoring cycle completed', {
        positionsChecked,
        warningsIssued,
        criticalAlertsIssued,
        liquidationAlertsIssued,
        duration: `${duration}ms`
      });

      return {
        success: true,
        positionsChecked,
        warnings: warningsIssued,
        criticalAlerts: criticalAlertsIssued,
        liquidationAlerts: liquidationAlertsIssued,
        duration
      };
    } catch (error) {
      console.error('Error in monitorAllPositions:', error);
      this.monitoringStats.errors++;
      throw error;
    }
  }

  /**
   * Check health of an individual position
   * Task 12.1.4: Implement checkPositionHealth(position) method
   * 
   * @param {Object} position - VesuPosition instance
   * @returns {Promise<Object>} Health check result
   */
  async checkPositionHealth(position) {
    try {
      // Skip positions with no debt (they can't be liquidated)
      if (!position.hasDebt()) {
        return {
          positionId: position.id,
          healthStatus: 'healthy',
          healthFactor: null,
          alertIssued: false
        };
      }

      // Update position health with latest prices
      const healthUpdate = await this.vesuService.updatePositionHealth(position.id);
      const healthFactor = healthUpdate.healthFactor ? parseFloat(healthUpdate.healthFactor) : null;

      // If health factor is null (no debt), position is healthy
      if (healthFactor === null) {
        return {
          positionId: position.id,
          healthStatus: 'healthy',
          healthFactor: null,
          alertIssued: false
        };
      }

      // Task 12.1.7: Identify liquidatable positions (health factor < 1.0)
      if (healthFactor < this.liquidationThreshold) {
        console.log(`LIQUIDATABLE position detected: ${position.id}, HF: ${healthFactor}`);
        await this.sendLiquidationAlert(position, healthFactor);
        return {
          positionId: position.id,
          healthStatus: 'liquidatable',
          healthFactor: healthFactor,
          alertIssued: true,
          alertType: 'liquidation'
        };
      }

      // Task 12.1.6: Identify critical positions (health factor < 1.05)
      if (healthFactor < this.criticalThreshold) {
        console.log(`CRITICAL position detected: ${position.id}, HF: ${healthFactor}`);
        await this.sendCriticalAlert(position, healthFactor);
        return {
          positionId: position.id,
          healthStatus: 'critical',
          healthFactor: healthFactor,
          alertIssued: true,
          alertType: 'critical'
        };
      }

      // Task 12.1.5: Identify at-risk positions (health factor < 1.2)
      if (healthFactor < this.warningThreshold) {
        console.log(`AT-RISK position detected: ${position.id}, HF: ${healthFactor}`);
        await this.sendWarningAlert(position, healthFactor);
        return {
          positionId: position.id,
          healthStatus: 'at-risk',
          healthFactor: healthFactor,
          alertIssued: true,
          alertType: 'warning'
        };
      }

      // Position is healthy
      return {
        positionId: position.id,
        healthStatus: 'healthy',
        healthFactor: healthFactor,
        alertIssued: false
      };
    } catch (error) {
      console.error(`Error checking position health for ${position.id}:`, error);
      throw error;
    }
  }

  /**
   * Send warning alert for at-risk position
   * Task 12.2.1: Send warning alerts for at-risk positions via Notification model
   * 
   * @param {Object} position - VesuPosition instance
   * @param {number} healthFactor - Current health factor
   * @returns {Promise<Object>} Created notification
   */
  async sendWarningAlert(position, healthFactor) {
    try {
      // Task 12.2.3: Log all position health changes to console and database
      console.log('Sending warning alert', {
        positionId: position.id,
        userId: position.user_id,
        healthFactor: healthFactor,
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset
      });

      // Task 12.2.4: Create notification records with type='position_health_warning'
      const notification = await this.notificationService.create({
        notification_id: uuidv4(),
        user_id: position.user_id,
        type: 'health_factor_warning',
        priority: 'medium',
        status: 'unread',
        title: 'Position Health Warning',
        message: `Your ${position.collateral_asset}-${position.debt_asset} position health factor is ${healthFactor.toFixed(4)}. Consider adding collateral or repaying debt.`,
        description: `Health factor has dropped below ${this.warningThreshold}. Your position may be at risk if prices continue to move unfavorably.`,
        category: 'defi',
        source: 'system',
        related_entities: {
          position_id: position.id
        },
        channels: {
          in_app: true,
          email: true,
          push: true
        },
        metadata: {
          position_id: position.id,
          pool_address: position.pool_address,
          collateral_asset: position.collateral_asset,
          debt_asset: position.debt_asset,
          health_factor: healthFactor,
          threshold: this.warningThreshold,
          alert_level: 'warning'
        },
        created_at: new Date()
      });

      console.log('Warning alert created', {
        notificationId: notification.notification_id,
        positionId: position.id
      });

      return notification;
    } catch (error) {
      console.error('Error sending warning alert:', error);
      throw error;
    }
  }

  /**
   * Send critical alert for near-liquidation position
   * Task 12.2.2: Send critical alerts for near-liquidation positions via Notification model
   * 
   * @param {Object} position - VesuPosition instance
   * @param {number} healthFactor - Current health factor
   * @returns {Promise<Object>} Created notification
   */
  async sendCriticalAlert(position, healthFactor) {
    try {
      // Task 12.2.3: Log all position health changes to console and database
      console.log('Sending critical alert', {
        positionId: position.id,
        userId: position.user_id,
        healthFactor: healthFactor,
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset
      });

      // Task 12.2.4: Create notification records with type='position_health_critical'
      const notification = await this.notificationService.create({
        notification_id: uuidv4(),
        user_id: position.user_id,
        type: 'position_liquidation',
        priority: 'critical',
        status: 'unread',
        title: 'CRITICAL: Position Near Liquidation',
        message: `URGENT: Your ${position.collateral_asset}-${position.debt_asset} position health factor is ${healthFactor.toFixed(4)}. Immediate action required!`,
        description: `Your position is critically close to liquidation (HF < ${this.criticalThreshold}). Add collateral or repay debt immediately to avoid liquidation.`,
        category: 'defi',
        source: 'system',
        related_entities: {
          position_id: position.id
        },
        channels: {
          in_app: true,
          email: true,
          push: true,
          sms: true
        },
        metadata: {
          position_id: position.id,
          pool_address: position.pool_address,
          collateral_asset: position.collateral_asset,
          debt_asset: position.debt_asset,
          health_factor: healthFactor,
          threshold: this.criticalThreshold,
          alert_level: 'critical'
        },
        created_at: new Date()
      });

      console.log('Critical alert created', {
        notificationId: notification.notification_id,
        positionId: position.id
      });

      return notification;
    } catch (error) {
      console.error('Error sending critical alert:', error);
      throw error;
    }
  }

  /**
   * Send liquidation alert for liquidatable position
   * Task 12.1.7: Identify liquidatable positions and trigger liquidation notifications
   * 
   * @param {Object} position - VesuPosition instance
   * @param {number} healthFactor - Current health factor
   * @returns {Promise<Object>} Created notification
   */
  async sendLiquidationAlert(position, healthFactor) {
    try {
      // Task 12.2.3: Log all position health changes to console and database
      console.log('Sending liquidation alert', {
        positionId: position.id,
        userId: position.user_id,
        healthFactor: healthFactor,
        collateralAsset: position.collateral_asset,
        debtAsset: position.debt_asset
      });

      // Create notification for liquidatable position
      const notification = await this.notificationService.create({
        notification_id: uuidv4(),
        user_id: position.user_id,
        type: 'position_liquidation',
        priority: 'critical',
        status: 'unread',
        title: 'LIQUIDATION ALERT: Position Liquidatable',
        message: `LIQUIDATION: Your ${position.collateral_asset}-${position.debt_asset} position (HF: ${healthFactor.toFixed(4)}) is now liquidatable!`,
        description: `Your position health factor has fallen below 1.0 and is now eligible for liquidation. Your collateral may be seized to repay debt.`,
        category: 'defi',
        source: 'system',
        related_entities: {
          position_id: position.id
        },
        channels: {
          in_app: true,
          email: true,
          push: true,
          sms: true
        },
        metadata: {
          position_id: position.id,
          pool_address: position.pool_address,
          collateral_asset: position.collateral_asset,
          debt_asset: position.debt_asset,
          health_factor: healthFactor,
          threshold: this.liquidationThreshold,
          alert_level: 'liquidation'
        },
        created_at: new Date()
      });

      console.log('Liquidation alert created', {
        notificationId: notification.notification_id,
        positionId: position.id
      });

      return notification;
    } catch (error) {
      console.error('Error sending liquidation alert:', error);
      throw error;
    }
  }

  /**
   * Get monitoring statistics
   * 
   * @returns {Object} Monitoring statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      monitoringInterval: this.monitoringInterval,
      thresholds: {
        warning: this.warningThreshold,
        critical: this.criticalThreshold,
        liquidation: this.liquidationThreshold
      },
      stats: this.monitoringStats
    };
  }

  /**
   * Reset monitoring statistics
   * 
   * @returns {void}
   */
  resetStats() {
    this.monitoringStats = {
      totalRuns: 0,
      positionsChecked: 0,
      warningsIssued: 0,
      criticalAlertsIssued: 0,
      liquidationAlertsIssued: 0,
      errors: 0
    };
    console.log('Monitoring statistics reset');
  }
}

module.exports = PositionMonitor;
