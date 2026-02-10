/**
 * Analytics Integration Tests
 * 
 * Tests the DeFi analytics endpoints and service integration
 */

const request = require('supertest');
const app = require('../server');
const { sequelize } = require('../models');
const User = require('../models/User');
const VesuPosition = require('../models/VesuPosition');
const VesuPool = require('../models/VesuPool');

describe('Analytics Integration Tests', () => {
  let authToken;
  let testUser;

  beforeAll(async () => {
    // Sync database
    await sequelize.sync({ force: true });

    // Create test user
    testUser = await User.create({
      email: 'analytics@test.com',
      password: 'hashedpassword123',
      wallet_address: '0x1234567890123456789012345678901234567890'
    });

    // Mock auth token
    authToken = 'test-token-' + testUser.id;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('GET /api/analytics/portfolio', () => {
    it('should return portfolio analytics for authenticated user', async () => {
      const response = await request(app)
        .get('/api/analytics/portfolio')
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
      
      if (response.body.success) {
        const { data } = response.body;
        expect(data).toHaveProperty('totalValueLocked');
        expect(data).toHaveProperty('totalDebt');
        expect(data).toHaveProperty('netValue');
        expect(data).toHaveProperty('positionCount');
      }
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .get('/api/analytics/portfolio')
        .expect(401);
    });
  });

  describe('GET /api/analytics/defi', () => {
    it('should return DeFi-specific analytics', async () => {
      const response = await request(app)
        .get('/api/analytics/defi')
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('success');
      
      if (response.body.success) {
        const { data } = response.body;
        expect(data).toHaveProperty('total_value_locked');
        expect(data).toHaveProperty('total_debt');
        expect(data).toHaveProperty('average_apy');
        expect(data).toHaveProperty('risk_metrics');
      }
    });
  });

  describe('GET /api/analytics/risk', () => {
    it('should return risk metrics', async () => {
      const response = await request(app)
        .get('/api/analytics/risk')
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('success');
      
      if (response.body.success) {
        const { data } = response.body;
        expect(data).toHaveProperty('overallRisk');
        expect(data).toHaveProperty('diversificationScore');
        expect(data).toHaveProperty('liquidationRisk');
      }
    });
  });

  describe('GET /api/analytics/protocol', () => {
    it('should return protocol-wide analytics without authentication', async () => {
      const response = await request(app)
        .get('/api/analytics/protocol')
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('success');
      
      if (response.body.success) {
        const { data } = response.body;
        expect(data).toHaveProperty('totalValueLocked');
        expect(data).toHaveProperty('totalBorrowed');
        expect(data).toHaveProperty('totalPools');
      }
    });
  });

  describe('GET /api/analytics/dashboard', () => {
    it('should return comprehensive dashboard analytics', async () => {
      const response = await request(app)
        .get('/api/analytics/dashboard')
        .set('Authorization', `Bearer ${authToken}`)
        .expect('Content-Type', /json/);

      expect(response.body).toHaveProperty('success');
      
      if (response.body.success) {
        const { data } = response.body;
        expect(data).toHaveProperty('portfolio');
        expect(data).toHaveProperty('risk');
        expect(data).toHaveProperty('yield');
        expect(data).toHaveProperty('protocol');
      }
    });
  });

  describe('With Active Positions', () => {
    beforeAll(async () => {
      // Create test pool
      await VesuPool.create({
        pool_address: '0xpool123',
        asset_address: '0xeth',
        total_supply: '1000000',
        total_borrow: '500000',
        supply_apy: '5.5',
        borrow_apy: '8.2',
        is_active: true
      });

      // Create test position
      await VesuPosition.create({
        user_id: testUser.id,
        pool_address: '0xpool123',
        collateral_asset: 'ETH',
        debt_asset: 'USDC',
        collateral_amount: '10',
        debt_amount: '5000',
        health_factor: '2.5',
        status: 'active'
      });
    });

    it('should return analytics with position data', async () => {
      const response = await request(app)
        .get('/api/analytics/portfolio')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.positionCount).toBeGreaterThan(0);
      expect(response.body.data.positions).toBeInstanceOf(Array);
    });

    it('should calculate risk metrics correctly', async () => {
      const response = await request(app)
        .get('/api/analytics/risk')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.overallRisk).toBeDefined();
      expect(response.body.data.diversificationScore).toBeGreaterThanOrEqual(0);
      expect(response.body.data.diversificationScore).toBeLessThanOrEqual(100);
    });
  });
});
