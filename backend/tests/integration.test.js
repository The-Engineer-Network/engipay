const request = require('supertest');
const app = require('../server');

describe('Integration Tests', () => {
  describe('Health Check', () => {
    it('should return server health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.status).toBe('OK');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for non-existent endpoints', async () => {
      const response = await request(app)
        .get('/api/non-existent-endpoint')
        .expect('Content-Type', /json/)
        .expect(404);

      expect(response.body.error.code).toBe('NOT_FOUND');
      expect(response.body.error.message).toBe('Endpoint not found');
    });
  });

  describe('CORS Headers', () => {
    it('should handle preflight requests', async () => {
      const response = await request(app)
        .options('/api/swap/quotes')
        .expect(204); // OPTIONS requests return 204 No Content
    });
  });
});