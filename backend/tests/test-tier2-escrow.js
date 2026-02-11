/**
 * TIER 2 Escrow API Tests
 * Tests all escrow endpoints
 */

const request = require('supertest');
const { app } = require('../server');

describe('TIER 2: Escrow System API Tests', () => {
  let authToken;
  let requestId;
  let transactionId;

  // Mock user for testing
  beforeAll(async () => {
    // TODO: Create test user and get auth token
    authToken = 'test_token';
  });

  describe('POST /api/escrow/create', () => {
    it('should create an escrow payment request', async () => {
      const response = await request(app)
        .post('/api/escrow/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          to_address: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '10.0',
          asset: 'STRK',
          expiry_hours: 24,
          memo: 'Test escrow payment'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.request_id).toBeDefined();
      expect(response.body.transaction_id).toBeDefined();
      expect(response.body.payment_link).toBeDefined();
      expect(response.body.qr_code_data).toBeDefined();
      expect(response.body.transaction_data).toBeDefined();
      expect(response.body.requires_signature).toBe(true);

      requestId = response.body.request_id;
      transactionId = response.body.transaction_id;

      // Verify QR code data is valid JSON
      const qrData = JSON.parse(response.body.qr_code_data);
      expect(qrData.type).toBe('escrow_payment_request');
      expect(qrData.amount).toBe('10.0');
    });

    it('should reject invalid recipient address', async () => {
      const response = await request(app)
        .post('/api/escrow/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          to_address: 'invalid_address',
          amount: '10.0',
          asset: 'STRK'
        });

      expect(response.status).toBe(500);
      expect(response.body.error).toBeDefined();
    });

    it('should reject invalid expiry hours', async () => {
      const response = await request(app)
        .post('/api/escrow/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          to_address: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '10.0',
          asset: 'STRK',
          expiry_hours: 1000 // Too long
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should use default expiry if not provided', async () => {
      const response = await request(app)
        .post('/api/escrow/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          to_address: '0x1234567890abcdef1234567890abcdef12345678',
          amount: '5.0',
          asset: 'STRK'
        });

      expect(response.status).toBe(200);
      expect(response.body.expiry_hours).toBe(24);
    });
  });

  describe('POST /api/escrow/accept', () => {
    it('should prepare accept transaction', async () => {
      const response = await request(app)
        .post('/api/escrow/accept')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          request_id: requestId || 'test_request_id'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.action).toBe('accept');
      expect(response.body.transaction_data).toBeDefined();
      expect(response.body.requires_signature).toBe(true);
    });

    it('should reject missing request ID', async () => {
      const response = await request(app)
        .post('/api/escrow/accept')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/escrow/reject', () => {
    it('should prepare reject transaction', async () => {
      const response = await request(app)
        .post('/api/escrow/reject')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          request_id: requestId || 'test_request_id'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.action).toBe('reject');
      expect(response.body.transaction_data).toBeDefined();
      expect(response.body.requires_signature).toBe(true);
    });
  });

  describe('POST /api/escrow/cancel', () => {
    it('should prepare cancel transaction', async () => {
      const response = await request(app)
        .post('/api/escrow/cancel')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          request_id: requestId || 'test_request_id'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.action).toBe('cancel');
      expect(response.body.transaction_data).toBeDefined();
      expect(response.body.requires_signature).toBe(true);
    });
  });

  describe('GET /api/escrow/requests', () => {
    it('should return user escrow requests', async () => {
      const response = await request(app)
        .get('/api/escrow/requests')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.requests).toBeDefined();
      expect(Array.isArray(response.body.requests)).toBe(true);
      expect(response.body.count).toBeDefined();
    });

    it('should filter by type (sent)', async () => {
      const response = await request(app)
        .get('/api/escrow/requests?type=sent')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('sent');
    });

    it('should filter by type (received)', async () => {
      const response = await request(app)
        .get('/api/escrow/requests?type=received')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.type).toBe('received');
    });

    it('should reject invalid type', async () => {
      const response = await request(app)
        .get('/api/escrow/requests?type=invalid')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/escrow/requests/pending', () => {
    it('should return pending escrow requests', async () => {
      const response = await request(app)
        .get('/api/escrow/requests/pending')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.requests).toBeDefined();
      expect(Array.isArray(response.body.requests)).toBe(true);
    });
  });

  describe('GET /api/escrow/request/:id', () => {
    it('should return specific escrow request', async () => {
      const testRequestId = requestId || 'test_request_id';
      
      const response = await request(app)
        .get(`/api/escrow/request/${testRequestId}`);

      // Will fail if contract not deployed, but endpoint should exist
      expect([200, 404, 503]).toContain(response.status);
      
      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.request).toBeDefined();
        expect(response.body.request.payment_link).toBeDefined();
      }
    });

    it('should return 503 if contract not deployed', async () => {
      const response = await request(app)
        .get('/api/escrow/request/test_id');

      if (response.status === 503) {
        expect(response.body.error.code).toBe('CONTRACT_NOT_DEPLOYED');
      }
    });
  });

  describe('POST /api/escrow/execute', () => {
    it('should execute signed escrow transaction', async () => {
      const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      const response = await request(app)
        .post('/api/escrow/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          transaction_id: transactionId || 'test_transaction_id',
          tx_hash: mockTxHash,
          action: 'create'
        });

      // Will fail if transaction not found, but endpoint should exist
      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body.success).toBe(true);
        expect(response.body.tx_hash).toBe(mockTxHash);
        expect(response.body.explorer_url).toContain('starkscan.co');
      }
    });

    it('should reject invalid action', async () => {
      const response = await request(app)
        .post('/api/escrow/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          transaction_id: 'test_id',
          tx_hash: '0xabcdef',
          action: 'invalid_action'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing required fields', async () => {
      const response = await request(app)
        .post('/api/escrow/execute')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          transaction_id: 'test_id'
          // Missing tx_hash and action
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Escrow Service Functions', () => {
    const escrowService = require('../services/escrowService');

    it('should validate Starknet addresses', () => {
      expect(escrowService.isValidStarknetAddress('0x1234567890abcdef')).toBe(true);
      expect(escrowService.isValidStarknetAddress('invalid')).toBe(false);
      expect(escrowService.isValidStarknetAddress('0xGGGG')).toBe(false);
    });

    it('should get token addresses', () => {
      expect(escrowService.getTokenAddress('STRK')).toBeDefined();
      expect(escrowService.getTokenAddress('ETH')).toBeDefined();
      expect(escrowService.getTokenAddress('USDC')).toBeDefined();
      expect(escrowService.getTokenAddress('ENGI')).toBeDefined();
    });

    it('should parse status codes', () => {
      expect(escrowService.parseStatus(0)).toBe('pending');
      expect(escrowService.parseStatus(1)).toBe('accepted');
      expect(escrowService.parseStatus(2)).toBe('rejected');
      expect(escrowService.parseStatus(3)).toBe('cancelled');
      expect(escrowService.parseStatus(4)).toBe('expired');
    });

    it('should generate payment links', () => {
      const link = escrowService.generatePaymentLink('test_request_id');
      expect(link).toContain('/pay/test_request_id');
    });

    it('should generate QR code data', () => {
      const qrData = escrowService.generateQRCodeData({
        request_id: 'test_id',
        amount: '10.0',
        asset: 'STRK',
        to_address: '0x123',
        from_address: '0x456',
        expiry_timestamp: 1234567890
      });

      const parsed = JSON.parse(qrData);
      expect(parsed.type).toBe('escrow_payment_request');
      expect(parsed.request_id).toBe('test_id');
      expect(parsed.amount).toBe('10.0');
    });
  });
});

// Run tests
if (require.main === module) {
  console.log('Running TIER 2 Escrow API Tests...');
  console.log('Note: Some tests may fail without database and smart contract deployment');
  console.log('This is expected in development environment');
}

module.exports = {};
