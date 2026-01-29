/**
 * Manual test script for Pool Information API Endpoints
 * 
 * This script tests the three pool endpoints:
 * - GET /api/vesu/pools
 * - GET /api/vesu/pools/:address
 * - GET /api/vesu/pools/:address/interest-rate
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

describe('Pool Information API Endpoints', () => {
  describe('GET /api/vesu/pools', () => {
    it('should return list of active pools', async () => {
      const response = await request(app)
        .get('/api/vesu/pools')
        .expect('Content-Type', /json/);

      console.log('Response status:', response.status);
      console.log('Response body:', JSON.stringify(response.body, null, 2));

      // Should return 200 or 503 if services not initialized
      expect([200, 503]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('pools');
        expect(Array.isArray(response.body.pools)).toBe(true);
      }
    });

    it('should return cached data on second request', async () => {
      // First request
      const response1 = await request(app)
        .get('/api/vesu/pools');

      if (response1.status === 200) {
        // Second request (should be cached)
        const response2 = await request(app)
          .get('/api/vesu/pools')
          .expect(200);

        expect(response2.body).toHaveProperty('cached');
        if (response2.body.cached) {
          console.log('Cache working! Cache age:', response2.body.cacheAge, 'seconds');
        }
      }
    });
  });

  describe('GET /api/vesu/pools/:address', () => {
    it('should return 400 for invalid address format', async () => {
      const response = await request(app)
        .get('/api/vesu/pools/invalid-address')
        .expect('Content-Type', /json/);

      console.log('Invalid address response:', response.status);
      expect([400, 503]).toContain(response.status);
    });

    it('should return 404 for non-existent pool', async () => {
      const testAddress = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const response = await request(app)
        .get(`/api/vesu/pools/${testAddress}`)
        .expect('Content-Type', /json/);

      console.log('Non-existent pool response:', response.status);
      // Should return 404 or 503 if services not initialized
      expect([404, 503]).toContain(response.status);
    });

    it('should return detailed pool info for valid address', async () => {
      // First get list of pools
      const poolsResponse = await request(app).get('/api/vesu/pools');

      if (poolsResponse.status === 200 && poolsResponse.body.pools.length > 0) {
        const poolAddress = poolsResponse.body.pools[0].poolAddress;

        const response = await request(app)
          .get(`/api/vesu/pools/${poolAddress}`)
          .expect(200)
          .expect('Content-Type', /json/);

        console.log('Pool details:', JSON.stringify(response.body, null, 2));

        expect(response.body).toHaveProperty('pool');
        expect(response.body.pool).toHaveProperty('poolAddress');
        expect(response.body.pool).toHaveProperty('collateralAsset');
        expect(response.body.pool).toHaveProperty('debtAsset');
        expect(response.body.pool).toHaveProperty('maxLTV');
        expect(response.body.pool).toHaveProperty('utilizationRate');
      }
    });
  });

  describe('GET /api/vesu/pools/:address/interest-rate', () => {
    it('should return 400 for invalid address format', async () => {
      const response = await request(app)
        .get('/api/vesu/pools/invalid-address/interest-rate')
        .expect('Content-Type', /json/);

      console.log('Invalid address response:', response.status);
      expect([400, 503]).toContain(response.status);
    });

    it('should return interest rates for valid pool', async () => {
      // First get list of pools
      const poolsResponse = await request(app).get('/api/vesu/pools');

      if (poolsResponse.status === 200 && poolsResponse.body.pools.length > 0) {
        const poolAddress = poolsResponse.body.pools[0].poolAddress;

        const response = await request(app)
          .get(`/api/vesu/pools/${poolAddress}/interest-rate`)
          .expect('Content-Type', /json/);

        console.log('Interest rate response:', response.status);
        console.log('Interest rate data:', JSON.stringify(response.body, null, 2));

        // Should return 200 or 503 if services not initialized
        expect([200, 503]).toContain(response.status);

        if (response.status === 200) {
          expect(response.body).toHaveProperty('poolAddress');
          expect(response.body).toHaveProperty('borrowAPY');
          expect(response.body).toHaveProperty('supplyAPY');
          expect(response.body).toHaveProperty('collateralAsset');
          expect(response.body).toHaveProperty('debtAsset');
        }
      }
    });
  });
});

// Run tests if this file is executed directly
if (require.main === module) {
  console.log('Running manual pool endpoint tests...');
  console.log('Note: These tests require database connection and initialized services');
  console.log('Run with: node backend/tests/test-pool-endpoints.js');
}

module.exports = { app };
