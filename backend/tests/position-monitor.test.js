const PositionMonitor = require('../services/PositionMonitor');
const { VesuService } = require('../services/VesuService');
const Notification = require('../models/Notification');
const VesuPosition = require('../models/VesuPosition');

/**
 * Unit tests for PositionMonitor service
 * 
 * Tests the position monitoring functionality including:
 * - Initialization
 * - Position health checking
 * - Alert generation
 */

describe('PositionMonitor', () => {
  let positionMonitor;
  let mockVesuService;
  let mockNotificationService;

  beforeEach(() => {
    // Create mock VesuService
    mockVesuService = {
      updatePositionHealth: jest.fn()
    };

    // Create mock Notification service
    mockNotificationService = {
      create: jest.fn()
    };

    // Initialize PositionMonitor with mocks
    positionMonitor = new PositionMonitor(mockVesuService, mockNotificationService);
  });

  afterEach(() => {
    // Stop monitoring if running
    if (positionMonitor.isRunning) {
      positionMonitor.stop();
    }
    jest.clearAllMocks();
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      expect(positionMonitor).toBeDefined();
      expect(positionMonitor.vesuService).toBe(mockVesuService);
      expect(positionMonitor.notificationService).toBe(mockNotificationService);
      expect(positionMonitor.isRunning).toBe(false);
    });

    test('should load monitoring thresholds from config', () => {
      expect(positionMonitor.warningThreshold).toBeDefined();
      expect(positionMonitor.criticalThreshold).toBeDefined();
      expect(positionMonitor.liquidationThreshold).toBeDefined();
      expect(positionMonitor.warningThreshold).toBeGreaterThan(positionMonitor.criticalThreshold);
      expect(positionMonitor.criticalThreshold).toBeGreaterThan(positionMonitor.liquidationThreshold);
    });

    test('should initialize monitoring stats', () => {
      const stats = positionMonitor.getStats();
      expect(stats.stats.totalRuns).toBe(0);
      expect(stats.stats.positionsChecked).toBe(0);
      expect(stats.stats.warningsIssued).toBe(0);
      expect(stats.stats.criticalAlertsIssued).toBe(0);
      expect(stats.stats.liquidationAlertsIssued).toBe(0);
    });
  });

  describe('Start and Stop', () => {
    test('should start monitoring service', () => {
      positionMonitor.start();
      expect(positionMonitor.isRunning).toBe(true);
      expect(positionMonitor.cronJob).toBeDefined();
    });

    test('should not start if already running', () => {
      positionMonitor.start();
      const firstCronJob = positionMonitor.cronJob;
      positionMonitor.start();
      expect(positionMonitor.cronJob).toBe(firstCronJob);
    });

    test('should stop monitoring service', () => {
      positionMonitor.start();
      positionMonitor.stop();
      expect(positionMonitor.isRunning).toBe(false);
      expect(positionMonitor.cronJob).toBeNull();
    });

    test('should not error when stopping if not running', () => {
      expect(() => positionMonitor.stop()).not.toThrow();
    });
  });

  describe('checkPositionHealth', () => {
    test('should return healthy status for position with no debt', async () => {
      const mockPosition = {
        id: 'test-position-1',
        user_id: 'test-user-1',
        collateral_amount: '1.5',
        debt_amount: '0',
        hasDebt: () => false
      };

      const result = await positionMonitor.checkPositionHealth(mockPosition);

      expect(result.healthStatus).toBe('healthy');
      expect(result.healthFactor).toBeNull();
      expect(result.alertIssued).toBe(false);
      expect(mockVesuService.updatePositionHealth).not.toHaveBeenCalled();
    });

    test('should identify at-risk position (HF < 1.2)', async () => {
      const mockPosition = {
        id: 'test-position-2',
        user_id: 'test-user-2',
        collateral_amount: '1.5',
        debt_amount: '1000',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        hasDebt: () => true
      };

      mockVesuService.updatePositionHealth.mockResolvedValue({
        healthFactor: '1.15'
      });

      mockNotificationService.create.mockResolvedValue({
        notification_id: 'notif-1'
      });

      const result = await positionMonitor.checkPositionHealth(mockPosition);

      expect(result.healthStatus).toBe('at-risk');
      expect(result.healthFactor).toBe(1.15);
      expect(result.alertIssued).toBe(true);
      expect(result.alertType).toBe('warning');
      expect(mockNotificationService.create).toHaveBeenCalled();
    });

    test('should identify critical position (HF < 1.05)', async () => {
      const mockPosition = {
        id: 'test-position-3',
        user_id: 'test-user-3',
        collateral_amount: '1.5',
        debt_amount: '1000',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        hasDebt: () => true
      };

      mockVesuService.updatePositionHealth.mockResolvedValue({
        healthFactor: '1.02'
      });

      mockNotificationService.create.mockResolvedValue({
        notification_id: 'notif-2'
      });

      const result = await positionMonitor.checkPositionHealth(mockPosition);

      expect(result.healthStatus).toBe('critical');
      expect(result.healthFactor).toBe(1.02);
      expect(result.alertIssued).toBe(true);
      expect(result.alertType).toBe('critical');
      expect(mockNotificationService.create).toHaveBeenCalled();
    });

    test('should identify liquidatable position (HF < 1.0)', async () => {
      const mockPosition = {
        id: 'test-position-4',
        user_id: 'test-user-4',
        collateral_amount: '1.5',
        debt_amount: '1000',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        hasDebt: () => true
      };

      mockVesuService.updatePositionHealth.mockResolvedValue({
        healthFactor: '0.95'
      });

      mockNotificationService.create.mockResolvedValue({
        notification_id: 'notif-3'
      });

      const result = await positionMonitor.checkPositionHealth(mockPosition);

      expect(result.healthStatus).toBe('liquidatable');
      expect(result.healthFactor).toBe(0.95);
      expect(result.alertIssued).toBe(true);
      expect(result.alertType).toBe('liquidation');
      expect(mockNotificationService.create).toHaveBeenCalled();
    });

    test('should return healthy status for position with good HF', async () => {
      const mockPosition = {
        id: 'test-position-5',
        user_id: 'test-user-5',
        collateral_amount: '1.5',
        debt_amount: '500',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        hasDebt: () => true
      };

      mockVesuService.updatePositionHealth.mockResolvedValue({
        healthFactor: '2.5'
      });

      const result = await positionMonitor.checkPositionHealth(mockPosition);

      expect(result.healthStatus).toBe('healthy');
      expect(result.healthFactor).toBe(2.5);
      expect(result.alertIssued).toBe(false);
      expect(mockNotificationService.create).not.toHaveBeenCalled();
    });
  });

  describe('Alert Generation', () => {
    test('should create warning notification with correct fields', async () => {
      const mockPosition = {
        id: 'test-position-6',
        user_id: 'test-user-6',
        pool_address: '0x123',
        collateral_asset: 'ETH',
        debt_asset: 'USDC'
      };

      mockNotificationService.create.mockResolvedValue({
        notification_id: 'notif-4'
      });

      await positionMonitor.sendWarningAlert(mockPosition, 1.15);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'test-user-6',
          type: 'health_factor_warning',
          priority: 'medium',
          status: 'unread',
          title: 'Position Health Warning',
          category: 'defi',
          source: 'system'
        })
      );
    });

    test('should create critical notification with correct fields', async () => {
      const mockPosition = {
        id: 'test-position-7',
        user_id: 'test-user-7',
        pool_address: '0x456',
        collateral_asset: 'ETH',
        debt_asset: 'USDC'
      };

      mockNotificationService.create.mockResolvedValue({
        notification_id: 'notif-5'
      });

      await positionMonitor.sendCriticalAlert(mockPosition, 1.02);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'test-user-7',
          type: 'position_liquidation',
          priority: 'critical',
          status: 'unread',
          title: 'CRITICAL: Position Near Liquidation',
          category: 'defi',
          source: 'system'
        })
      );
    });

    test('should create liquidation notification with correct fields', async () => {
      const mockPosition = {
        id: 'test-position-8',
        user_id: 'test-user-8',
        pool_address: '0x789',
        collateral_asset: 'ETH',
        debt_asset: 'USDC'
      };

      mockNotificationService.create.mockResolvedValue({
        notification_id: 'notif-6'
      });

      await positionMonitor.sendLiquidationAlert(mockPosition, 0.95);

      expect(mockNotificationService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'test-user-8',
          type: 'position_liquidation',
          priority: 'critical',
          status: 'unread',
          title: 'LIQUIDATION ALERT: Position Liquidatable',
          category: 'defi',
          source: 'system'
        })
      );
    });
  });

  describe('Statistics', () => {
    test('should return monitoring statistics', () => {
      const stats = positionMonitor.getStats();

      expect(stats).toHaveProperty('isRunning');
      expect(stats).toHaveProperty('lastRunTime');
      expect(stats).toHaveProperty('monitoringInterval');
      expect(stats).toHaveProperty('thresholds');
      expect(stats).toHaveProperty('stats');
      expect(stats.thresholds).toHaveProperty('warning');
      expect(stats.thresholds).toHaveProperty('critical');
      expect(stats.thresholds).toHaveProperty('liquidation');
    });

    test('should reset statistics', () => {
      // Manually set some stats
      positionMonitor.monitoringStats.totalRuns = 10;
      positionMonitor.monitoringStats.warningsIssued = 5;

      positionMonitor.resetStats();

      const stats = positionMonitor.getStats();
      expect(stats.stats.totalRuns).toBe(0);
      expect(stats.stats.warningsIssued).toBe(0);
    });
  });
});
