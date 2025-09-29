const express = require('express');
const axios = require('axios');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/chipipay/skus
router.get('/skus', authenticateToken, async (req, res) => {
  try {
    const response = await axios.get('https://api.chipipay.com/v1/skus', {
      headers: {
        'Authorization': `Bearer ${process.env.CHIPIPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    res.json(response.data);
  } catch (error) {
    console.error('Chipi Pay SKUs fetch error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: {
        code: 'CHIPIPAY_API_ERROR',
        message: 'Failed to fetch available services'
      }
    });
  }
});

// POST /api/chipipay/buy
router.post('/buy', authenticateToken, [
  body('sku_id').isString().notEmpty().withMessage('SKU ID is required'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('recipient_address').optional().isEthereumAddress().withMessage('Invalid recipient address')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array()
        }
      });
    }

    const { sku_id, quantity = 1, recipient_address } = req.body;
    const userWallet = req.user.walletAddress;

    const requestBody = {
      sku_id,
      quantity,
      recipient_address: recipient_address || userWallet,
    };

    const response = await axios.post('https://api.chipipay.com/v1/buy', requestBody, {
      headers: {
        'Authorization': `Bearer ${process.env.CHIPIPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    // Log the transaction for tracking
    console.log(`Chipi Pay purchase: User ${req.user.id} bought SKU ${sku_id}`);

    res.json(response.data);
  } catch (error) {
    console.error('Chipi Pay purchase error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: {
        code: 'CHIPIPAY_PURCHASE_ERROR',
        message: 'Service purchase failed',
        details: error.response?.data
      }
    });
  }
});

// POST /api/webhooks/chipipay (for Chipi Pay webhooks)
router.post('/webhooks', (req, res) => {
  try {
    const signature = req.headers['chipipay-signature'];
    const payload = req.body;

    // TODO: Implement webhook signature verification
    // if (!verifyChipiPayWebhook(signature, payload)) {
    //   return res.status(401).json({ error: 'Invalid signature' });
    // }

    console.log('Chipi Pay webhook received:', payload);

    // Process webhook data based on event type
    const { event_type, transaction_id, status, user_id } = payload;

    // TODO: Update database with transaction status
    // TODO: Send notifications to user
    // TODO: Update user balance/portfolio

    res.json({ received: true });
  } catch (error) {
    console.error('Chipi Pay webhook processing error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_PROCESSING_ERROR',
        message: 'Failed to process webhook'
      }
    });
  }
});

module.exports = router;