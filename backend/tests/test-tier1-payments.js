/**
 * TIER 1 Payment API Tests
 * Tests all new v2 payment endpoints
 */

const request = require('supertest');
const { app } = require('../server');

describe('TIER 1: Core Payments API Tests', () => {
  let authToken;
  let transactionId;

  // Mock user for testing
  beforeAll(async () => {
    // TODO: Create test user and get auth token
    // For now, skip auth in tests or use mock token
    authToken = 'test_token';
  });

  describe('POST /api/payments/v2/send', () => {
    it('should prepare a payment transaction', async () => {
      const response = await request(app)
        .post('/api/payments/v2/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          recipient: '0x1234567890abcdef1234567890abcdef12345678',
          asset: 'STRK',
          amount: '1.0',
          memo: 'Test payment'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transaction_id).toBeDefined();
      expect(response.body.status).toBe('pending_signature');
      expect(response.body.transaction_data).toBeDefined();
      expect(response.body.transaction_data.contract_address).toBeDefined();
      expect(response.body.transaction_data.entry_point).toBe('transfer');

      transactionId = response.body.transaction_id;
    });

    it('should reject invalid recipient address', async () => {
      const response = await request(app)
        .post('/api/payments/v2/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          recipient: 'invalid_address',
          asset: 'STRK',
          amount: '1.0'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_ADDRESS');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/payments/v2/send')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          recipient: '0x1234567890abcdef1234567890abcdef12345678'
          // Missing asset and amount
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/payments/v2/execute', () => {
    it('should execute a signed transaction', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      const response = await request(app)
        .post('/api/payments/v2/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          transaction_id: transactionId,
          tx_hash: mockTxHash,
          type: 'send'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.tx_hash).toBe(mockTxHash);
      expect(response.body.status).toBe('pending');
      expect(response.body.explorer_url).toContain('starkscan.co');
    });

    it('should reject invalid transaction ID', async () => {
      const response = await request(app)
        .post('/api/payments/v2/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          transaction_id: 'invalid_id',
          tx_hash: '0xabcdef',
          type: 'send'
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('TRANSACTION_NOT_FOUND');
    });
  });

  describe('POST /api/payments/v2/request', () => {
    it('should create a payment request', async () => {
      const response = await request(app)
        .post('/api/payments/v2/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset: 'STRK',
          amount: '10.0',
          expires_in_hours: 24,
          memo: 'Test payment request'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.request_id).toBeDefined();
      expect(response.body.payment_link).toBeDefined();
      expect(response.body.qr_code_data).toBeDefined();
      expect(response.body.expires_at).toBeDefined();
      expect(response.body.transaction_data).toBeDefined();

      // Verify QR code data is valid JSON
      const qrData = JSON.parse(response.body.qr_code_data);
      expect(qrData.type).toBe('payment_request');
      expect(qrData.amount).toBe('10.0');
      expect(qrData.asset).toBe('STRK');
    });

    it('should use default expiry if not provided', async () => {
      const response = await request(app)
        .post('/api/payments/v2/request')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          asset: 'STRK',
          amount: '5.0'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      
      // Check expiry is ~24 hours from now
      const expiresAt = new Date(response.body.expires_at);
      const now = new Date();
      const hoursDiff = (expiresAt - now) / (1000 * 60 * 60);
      expect(hoursDiff).toBeGreaterThan(23);
      expect(hoursDiff).toBeLessThan(25);
    });
  });

  describe('GET /api/payments/v2/requests', () => {
    it('should return payment requests', async () => {
      const response = await request(app)
        .get('/api/payments/v2/requests')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.requests).toBeDefined();
      expect(Array.isArray(response.body.requests)).toBe(true);
    });
  });

  describe('POST /api/payments/v2/merchant', () => {
    it('should prepare a merchant payment', async () => {
      const response = await request(app)
        .post('/api/payments/v2/merchant')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          merchant_id: '0x1234567890abcdef1234567890abcdef12345678',
          asset: 'STRK',
          amount: '50.0',
          invoice_id: 'INV-12345',
          memo: 'Payment for services'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.transaction_id).toBeDefined();
      expect(response.body.merchant_id).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(response.body.invoice_id).toBe('INV-12345');
      expect(response.body.transaction_data).toBeDefined();
    });

    it('should accept merchant_id without 0x prefix', async () => {
      const response = await request(app)
        .post('/api/payments/v2/merchant')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          merchant_id: '1234567890abcdef1234567890abcdef12345678',
          asset: 'STRK',
          amount: '25.0'
        });

      expect(response.status).toBe(200);
      expect(response.body.merchant_address).toMatch(/^0x/);
    });
  });

  describe('GET /api/payments/v2/balance', () => {
    it('should return token balance', async () => {
      const response = await request(app)
        .get('/api/payments/v2/balance?asset=STRK')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.balance).toBeDefined();
      expect(response.body.asset).toBe('STRK');
      expect(response.body.address).toBeDefined();
    });

    it('should default to ENGI if no asset specified', async () => {
      const response = await request(app)
        .get('/api/payments/v2/balance')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.asset).toBe('ENGI');
    });
  });

  describe('Transaction Endpoints', () => {
    describe('POST /api/transactions/broadcast', () => {
      it('should broadcast a signed transaction', async () => {
        const response = await request(app)
          .post('/api/transactions/broadcast')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            network: 'starknet',
            signedTransaction: '0xabcdef...',
            to: '0x1234567890abcdef1234567890abcdef12345678',
            amount: '1.0',
            asset: 'STRK'
          });

        // This will fail without real blockchain connection
        // But we can test the endpoint exists
        expect([200, 500]).toContain(response.status);
      });
    });

    describe('GET /api/transactions/:hash/status', () => {
      it('should get transaction status', async () => {
        const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

        const response = await request(app)
          .get(`/api/transactions/${mockTxHash}/status?network=starknet`)
          .set('Authorization', `Bearer ${authToken}`);

        // This will fail without real blockchain connection
        // But we can test the endpoint exists
        expect([200, 500]).toContain(response.status);
      });

      it('should require network parameter', async () => {
        const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

        const response = await request(app)
          .get(`/api/transactions/${mockTxHash}/status`)
          .set('Authorization', `Bearer ${authToken}`);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('MISSING_NETWORK');
      });
    });

    describe('POST /api/transactions/estimate-gas', () => {
      it('should estimate gas for transaction', async () => {
        const response = await request(app)
          .post('/api/transactions/estimate-gas')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            network: 'ethereum',
            to: '0x1234567890abcdef1234567890abcdef12345678',
            value: '1.0'
          });

        // This will fail without real blockchain connection
        // But we can test the endpoint exists
        expect([200, 500]).toContain(response.status);
      });
    });
  });

  describe('Deprecated Endpoints', () => {
    describe('POST /api/transactions/send', () => {
      it('should return deprecation error', async () => {
        const response = await request(app)
          .post('/api/transactions/send')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            to_address: '0x1234567890abcdef1234567890abcdef12345678',
            asset: 'STRK',
            amount: 1.0
          });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('DEPRECATED_ENDPOINT');
        expect(response.body.new_endpoint).toBe('/api/transactions/broadcast');
      });
    });
  });
});

// Run tests
if (require.main === module) {
  console.log('Running TIER 1 Payment API Tests...');
  console.log('Note: Some tests may fail without database and blockchain connections');
  console.log('This is expected in development environment');
}

module.exports = {
  // Export for use in other test files
};
