/**
 * Manual test script for Liquidation API Endpoints
 * 
 * This script tests the three liquidation endpoints:
 * - GET /api/vesu/liquidations/opportunities
 * - POST /api/vesu/liquidations/execute
 * - GET /api/vesu/liquidations/history
 * 
 * Run this after registering routes in server.js
 */

const request = require('supertest');
const express = require('express');
const vesuRoutes = require('../routes/vesu');

// Create a test Express app
const app = express();
app.use(express.json());
app.use('/api/vesu', vesuRoutes);

describe('Liquidation API Endpoints', () => {
  describe('GET /api/vesu/liquidations/opportunities', () => {
    it('should return list of liquidatable positions', async () => {
      const response = await request(app)
        .get('/api/vesu/liquidations/opportunities')
        .expect('Content-Type', /json/);

      console.log('Response status:', response.status);
      console.log('Response body:', JSON.stringify(response.body, null, 2));

      // Should return 200 or 503 if services not initialized
      expect([200, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('opportunities');
        expect(Array.isArray(response.body.opportunities)).toBe(true);
        expect(response.body).toHaveProperty('count');
        expect(response.body).toHaveProperty('timestamp');
      }
    });

    it('should handle rate limiting', async () => {
      // Make multiple requests to test rate limiting (20 per 15 minutes)
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .get('/api/vesu/liquidations/opportunities')
        );
      }

      const responses = await Promise.all(requests);
      
      // All should succeed (under rate limit)
      responses.forEach(response => {
        expect([200, 503]).toContain(response.status);
      });
    });
  });

  describe('GET /api/vesu/liquidations/history', () => {
    it('should return liquidation history with pagination', async () => {
      const response = await request(app)
        .get('/api/vesu/liquidations/history')
        .query({ limit: 10, offset: 0 })
        .expect('Content-Type', /json/);

      console.log('Response status:', response.status);
      console.log('Response body:', JSON.stringify(response.body, null, 2));

      // Should return 200 (no auth required)
      expect(response.status).toBe(200);

      expect(response.body).toHaveProperty('liquidations');
      expect(Array.isArray(response.body.liquidations)).toBe(true);
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination).toHaveProperty('total');
      expect(response.body.pagination).toHaveProperty('limit');
      expect(response.body.pagination).toHaveProperty('offset');
      expect(response.body.pagination).toHaveProperty('hasMore');
    });

    it('should validate pagination parameters', async () => {
      // Test invalid limit
      const response1 = await request(app)
        .get('/api/vesu/liquidations/history')
        .query({ limit: 200 }); // Max is 100

      expect(response1.status).toBe(400);
      expect(response1.body).toHaveProperty('error');

      // Test invalid offset
      const response2 = await request(app)
        .get('/api/vesu/liquidations/history')
        .query({ offset: -1 });

      expect(response2.status).toBe(400);
      expect(response2.body).toHaveProperty('error');
    });

    it('should handle default pagination', async () => {
      const response = await request(app)
        .get('/api/vesu/liquidations/history')
        .expect(200);

      // Default limit should be 50
      expect(response.body.pagination.limit).toBe(50);
      expect(response.body.pagination.offset).toBe(0);
    });
  });

  describe('POST /api/vesu/liquidations/execute', () => {
    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/vesu/liquidations/execute')
        .send({
          positionId: 'test-position-id',
          liquidatorAddress: '0x1234567890abcdef'
        });

      // Should return 401 without auth token
      expect(response.status).toBe(401);
    });

    it('should validate required fields', async () => {
      // Mock JWT token (in real test, use valid token)
      const mockToken = 'Bearer mock-jwt-token';

      const response = await request(app)
        .post('/api/vesu/liquidations/execute')
        .set('Authorization', mockToken)
        .send({
          // Missing positionId and liquidatorAddress
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error');
    });

    it('should validate liquidator address format', async () => {
      const mockToken = 'Bearer mock-jwt-token';

      const response = await request(app)
        .post('/api/vesu/liquidations/execute')
        .set('Authorization', mockToken)
        .send({
          positionId: 'test-position-id',
          liquidatorAddress: 'invalid-address' // Invalid format
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});

// Run the tests
if (require.main === module) {
  console.log('Running liquidation endpoint tests...');
  console.log('Note: These tests require the database and services to be initialized.');
  console.log('Some tests may fail if services are not available (503 status).');
}

module.exports = app;
