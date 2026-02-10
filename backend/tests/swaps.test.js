const request = require('supertest');
const { sequelize } = require('../config/database');
const app = require('../server');
const { Swap, SwapQuote } = require('../models');

describe('Swaps API', () => {
  beforeAll(async () => {
    // Sync database for tests
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    // Close database connection
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear tables before each test
    await Swap.destroy({ where: {}, truncate: true });
    await SwapQuote.destroy({ where: {}, truncate: true });
  });

  describe('POST /api/swap/quote', () => {
    it('should return a swap quote', async () => {
      const response = await request(app)
        .post('/api/swap/quote')
        .send({
          fromToken: 'BTC',
          toToken: 'STRK',
          amount: 0.1
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('quote');
    });
  });

  describe('POST /api/swap/execute', () => {
    it('should execute a swap', async () => {
      const response = await request(app)
        .post('/api/swap/execute')
        .send({
          fromToken: 'BTC',
          toToken: 'STRK',
          amount: 0.1,
          walletAddress: '0x1234567890abcdef'
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('swap');
    });
  });
});
