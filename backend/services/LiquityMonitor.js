/**
 * Liquity Trove Monitoring Service
 * 
 * Monitors Trove health and sends alerts for liquidation risks
 */

const cron = require('node-cron');
const liquityService = require('./LiquityService');
const LiquityTrove = require('../models/LiquityTrove');
const Notification = require('../models/Notification');
const { LIQUITY_CONFIG } = require('../config/liquity.config');
const { Op } = require('sequelize');

class LiquityMonitor {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
    this.checkInterval = LIQUITY_CONFIG.monitoring.checkInterval || 60000;
  }

  /**
   * Start monitoring service
   */
  start() {
    if (this.isRunning) {
      console.log('  Liquity monitor already running');
      return;
    }

    console.log(' Starting Liquity Trove monitoring service...');
    
    // Run initial check
    this.checkAllTroves().catch(err => {
      console.error('Error in initial Trove check:', err);
    });

    // Schedule periodic checks (every minute)
    this.cronJob = cron.schedule('* * * * *', async () => {
      try {
        await this.checkAllTroves();
      } catch (error) {
        console.error('Error in scheduled Trove check:', error);
      }
    });

    this.isRunning = true;
    console.log(' Liquity monitor started');
  }

  /**
   * Stop monitoring service
   */
  stop() {
    if (!this.isRunning) {
      console.log('  Liquity monitor not running');
      return;
    }

    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    this.isRunning = false;
    console.log(' Liquity monitor stopped');
  }

  /**
   * Check all active Troves
   */
  async checkAllTroves() {
    try {
      // Get all active Troves
      const troves = await LiquityTrove.findAll({
        where: {
          status: 'active',
        },
      });

      if (troves.length === 0) {
        return;
      }

      console.log(`🔍 Checking ${troves.length} active Troves...`);

      // Check each Trove
      for (const trove of troves) {
        try {
          await this.checkTrove(trove);
        } catch (error) {
          console.error(`Error checking Trove ${trove.id}:`, error);
        }
      }

      console.log(' Trove check completed');
    } catch (error) {
      console.error('Error checking Troves:', error);
      throw error;
    }
  }

  /**
   * Check individual Trove health
   */
  async checkTrove(trove) {
    try {
      // Get current Trove state from blockchain
      const currentState = await liquityService.getTrove(trove.ownerAddress);

      // Update Trove record
      await trove.update({
        collateral: currentState.collateral,
        debt: currentState.debt,
        collateralRatio: currentState.collateralRatio,
        ethPrice: currentState.ethPrice,
        liquidationPrice: currentState.liquidationPrice,
        lastMonitoredAt: new Date(),
      });

      // Calculate health metrics
      trove.healthScore = trove.calculateHealthScore();
      trove.updateRiskLevel();
      await trove.save();

      // Check for alerts
      await this.checkAlerts(trove, currentState);

      // Auto top-up if enabled and needed
      if (LIQUITY_CONFIG.monitoring.autoTopUpEnabled) {
        await this.autoTopUp(trove, currentState);
      }

      return currentState;
    } catch (error) {
      console.error(`Error checking Trove ${trove.id}:`, error);
      throw error;
    }
  }

  /**
   * Check if alerts need to be sent
   */
  async checkAlerts(trove, currentState) {
    const cr = currentState.collateralRatio;
    const { liquidationWarningThreshold, criticalThreshold } = LIQUITY_CONFIG.monitoring;

    let alertLevel = null;
    let alertMessage = null;

    if (cr < 1.1) {
      alertLevel = 'critical';
      alertMessage = ` CRITICAL: Trove at liquidation threshold! CR: ${(cr * 100).toFixed(2)}%`;
    } else if (cr < criticalThreshold) {
      alertLevel = 'critical';
      alertMessage = ` CRITICAL: Trove near liquidation! CR: ${(cr * 100).toFixed(2)}%`;
    } else if (cr < liquidationWarningThreshold) {
      alertLevel = 'warning';
      alertMessage = ` WARNING: Low collateral ratio! CR: ${(cr * 100).toFixed(2)}%`;
    }

    if (alertLevel) {
      console.log(alertMessage);

      // Create notification
      await Notification.create({
        userId: trove.userId,
        type: 'liquity_alert',
        title: 'Liquity Trove Alert',
        message: alertMessage,
        priority: alertLevel === 'critical' ? 'high' : 'medium',
        metadata: {
          troveId: trove.id,
          collateralRatio: cr,
          ethPrice: currentState.ethPrice,
          liquidationPrice: currentState.liquidationPrice,
          collateral: currentState.collateral,
          debt: currentState.debt,
        },
      });

      // Increment alert counter
      await trove.update({
        alertsSent: trove.alertsSent + 1,
      });

      // Send webhook if configured
      if (LIQUITY_CONFIG.alerts.enabled && LIQUITY_CONFIG.alerts.webhookUrl) {
        await this.sendWebhookAlert(trove, alertLevel, alertMessage, currentState);
      }
    }
  }

  /**
   * Auto top-up Trove if needed
   */
  async autoTopUp(trove, currentState) {
    const { autoTopUpThreshold, autoTopUpTarget } = LIQUITY_CONFIG.monitoring;
    const cr = currentState.collateralRatio;

    if (cr < autoTopUpThreshold) {
      console.log(`🔄 Auto top-up triggered for Trove ${trove.id}`);

      // Calculate how much ETH to add to reach target CR
      const currentCollateralValue = currentState.collateral * currentState.ethPrice;
      const targetCollateralValue = currentState.debt * autoTopUpTarget;
      const additionalCollateralValue = targetCollateralValue - currentCollateralValue;
      const additionalCollateral = additionalCollateralValue / currentState.ethPrice;

      if (additionalCollateral > 0) {
        try {
          await liquityService.adjustTrove(trove.userId, trove.id, {
            depositCollateral: additionalCollateral,
          });

          console.log(` Auto top-up completed: Added ${additionalCollateral.toFixed(4)} ETH`);

          // Create notification
          await Notification.create({
            userId: trove.userId,
            type: 'liquity_auto_topup',
            title: 'Trove Auto Top-Up',
            message: `Added ${additionalCollateral.toFixed(4)} ETH to maintain safe collateral ratio`,
            priority: 'medium',
            metadata: {
              troveId: trove.id,
              addedCollateral: additionalCollateral,
              previousCR: cr,
              targetCR: autoTopUpTarget,
            },
          });
        } catch (error) {
          console.error('Error during auto top-up:', error);
        }
      }
    }
  }

  /**
   * Send webhook alert
   */
  async sendWebhookAlert(trove, level, message, state) {
    try {
      const axios = require('axios');
      
      await axios.post(LIQUITY_CONFIG.alerts.webhookUrl, {
        event: 'liquity_alert',
        level,
        message,
        trove: {
          id: trove.id,
          ownerAddress: trove.ownerAddress,
          collateralRatio: state.collateralRatio,
          collateral: state.collateral,
          debt: state.debt,
          ethPrice: state.ethPrice,
          liquidationPrice: state.liquidationPrice,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Error sending webhook alert:', error);
    }
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: this.checkInterval,
      config: LIQUITY_CONFIG.monitoring,
    };
  }

  /**
   * Manual check for specific Trove
   */
  async checkTroveById(troveId) {
    const trove = await LiquityTrove.findByPk(troveId);
    
    if (!trove) {
      throw new Error('Trove not found');
    }

    return await this.checkTrove(trove);
  }
}

// Export singleton instance
const liquityMonitor = new LiquityMonitor();

module.exports = liquityMonitor;
