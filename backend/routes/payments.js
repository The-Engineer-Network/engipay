const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/payments/send
router.post('/send', authenticateToken, (req, res) => {
  const { recipient, asset, amount, memo, network } = req.body;

  res.json({
    transaction_id: `tx_${Date.now()}`,
    tx_hash: `0x${Math.random().toString(16).substring(2)}`,
    status: 'pending',
    estimated_completion: new Date(Date.now() + 2 * 60 * 1000).toISOString()
  });
});

// GET /api/payments/requests
router.get('/requests', authenticateToken, (req, res) => {
  res.json({
    requests: [
      {
        id: 'req_123',
        from_address: '0xabcd...1234',
        asset: 'ETH',
        amount: '0.5',
        memo: 'Invoice payment',
        expires_at: '2024-01-20T00:00:00Z',
        status: 'pending'
      }
    ]
  });
});

// POST /api/payments/request
router.post('/request', authenticateToken, (req, res) => {
  const { asset, amount, memo, expires_in_hours } = req.body;

  res.json({
    request_id: `req_${Date.now()}`,
    payment_link: `https://engipay.com/pay/req_${Date.now()}`
  });
});

module.exports = router;