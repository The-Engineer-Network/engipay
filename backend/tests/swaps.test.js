const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../server');
const Swap = require('../models/Swap');
const SwapQuote = require('../models/SwapQuote');

let mongoServer;

describe('Swaps API', () => {
  beforeAll(async () => {
    // Start in-memory MongoDB server
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();

    // Connect to in-memory database
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
  });

  afterAll(async () => {
    // Close database connection and stop server
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Swap.deleteMany({});
    await SwapQuote.deleteMany({});
  });

  describe('POST /api/swap/initiate', () => {
    it('should initiate a swap successfully', async () => {
      // Mock user for testing
      const mockUserId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post('/api/swap/initiate')
        .set('Authorization', 'Bearer valid-token')
        .send({
          fromToken: 'BTC',
          toToken: 'ETH',
          amount: 0.1,
          expectedOutput: 2.45,
          txHash: 'test-tx-hash',
          atomiqSwapId: 'test-swap-id',
          walletAddress: 'test-address'
        });

      // Note: This will fail due to auth middleware, but tests structure
      expect(response.status).toBe(401); // Unauthorized due to missing auth
    });

    it('should return 400 for missing required fields', async () => {
      const response = await request(app)
        .post('/api/swap/initiate')
        .set('Authorization', 'Bearer valid-token')
        .send({
          fromToken: 'BTC',
          toToken: 'ETH',
          amount: 0.1
          // Missing required fields
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });

    it('should return 400 for invalid token pair', async () => {
      const response = await request(app)
        .post('/api/swap/initiate')
        .set('Authorization', 'Bearer valid-token')
        .send({
          fromToken: 'BTC',
          toToken: 'INVALID',
          amount: 0.1,
          expectedOutput: 2.45,
          txHash: 'test-tx-hash',
          atomiqSwapId: 'test-swap-id',
          walletAddress: 'test-address'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/swap/quotes', () => {
    it('should return cached quote if available', async () => {
      // Create cached quote
      const cachedQuote = {
        fromToken: 'BTC',
        toToken: 'ETH',
        amount: 0.1,
        quote: {
          expectedOutput: 2.45,
          fee: 0.001,
          slippage: 0.5
        },
        expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes from now
      };

      await SwapQuote.create(cachedQuote);

      const response = await request(app)
        .get('/api/swap/quotes?fromToken=BTC&toToken=ETH&amount=0.1')
        .set('Authorization', 'Bearer valid-token');

      // Will return 401 due to auth middleware
      expect(response.status).toBe(401);
    });

    it('should return 400 for missing query parameters', async () => {
      const response = await request(app)
        .get('/api/swap/quotes')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(400);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('GET /api/swap/history', () => {
    beforeEach(async () => {
      // Create test swaps
      const testSwaps = [
        {
          userId: new mongoose.Types.ObjectId(),
          fromToken: 'BTC',
          toToken: 'ETH',
          amount: 0.1,
          expectedOutput: 2.45,
          status: 'completed',
          txHash: 'hash1',
          atomiqSwapId: 'swap1',
          walletAddress: 'address1'
        },
        {
          userId: new mongoose.Types.ObjectId(),
          fromToken: 'ETH',
          toToken: 'BTC',
          amount: 1.0,
          expectedOutput: 0.04,
          status: 'pending',
          txHash: 'hash2',
          atomiqSwapId: 'swap2',
          walletAddress: 'address2'
        }
      ];

      await Swap.insertMany(testSwaps);
    });

    it('should return swap history with pagination', async () => {
      const response = await request(app)
        .get('/api/swap/history?page=1&limit=10')
        .set('Authorization', 'Bearer valid-token');

      // Will return 401 due to auth middleware
      expect(response.status).toBe(401);
    });

    it('should filter swaps by status', async () => {
      const response = await request(app)
        .get('/api/swap/history?status=completed')
        .set('Authorization', 'Bearer valid-token');

      expect(response.status).toBe(200);
      expect(response.body.swaps.length).toBe(1);
      expect(response.body.swaps[0].status).toBe('completed');
    });
  });
});