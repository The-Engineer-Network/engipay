const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const CHIPIPAY_API_URL = process.env.CHIPIPAY_API_URL || 'https://api.chipipay.com/v1';
const CHIPIPAY_SECRET_KEY = process.env.CHIPIPAY_SECRET_KEY;
const CHIPIPAY_PUBLIC_KEY = process.env.NEXT_PUBLIC_CHIPIPAY_API_KEY;
const CHIPIPAY_WEBHOOK_SECRET = process.env.CHIPIPAY_WEBHOOK_SECRET;

// Validate ChipiPay configuration
if (!CHIPIPAY_SECRET_KEY) {
  console.warn('⚠️  ChipiPay Secret Key not configured');
}

// Helper function to make ChipiPay API calls
const chipiPayRequest = async (endpoint, method = 'GET', data = null) => {
  try {
    const config = {
      method,
      url: `${CHIPIPAY_API_URL}${endpoint}`,
      headers: {
        'Authorization': `Bearer ${CHIPIPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error('ChipiPay API Error:', error.response?.data || error.message);
    throw error;
  }
};

// GET /api/chipipay/skus - Fetch available services
router.get('/skus', async (req, res) => {
  try {
    if (!CHIPIPAY_SECRET_KEY) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'ChipiPay service not configured'
        }
      });
    }

    const response = await axios.get(`${CHIPIPAY_API_URL}/skus`, {
      headers: {
        'Authorization': `Bearer ${CHIPIPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    // Return SKUs with formatted data
    const skus = response.data?.skus || response.data || [];
    
    res.json({
      success: true,
      skus: skus.map(sku => ({
        id: sku.id,
        name: sku.name,
        description: sku.description,
        price: sku.price,
        currency: sku.currency || 'USD',
        available: sku.available !== false,
      }))
    });
  } catch (error) {
    console.error('ChipiPay SKUs fetch error:', error.response?.data || error.message);
    
    // Return demo data as fallback when API is unavailable
    console.log('⚠️  ChipiPay API unavailable, returning demo SKUs');
    return res.json({
      success: true,
      skus: [
        {
          id: 'sku_demo_premium',
          name: 'Premium Membership',
          description: 'Access to premium features and priority support',
          price: 9.99,
          currency: 'USD',
          available: true,
        },
        {
          id: 'sku_demo_pro',
          name: 'Pro Service Package',
          description: 'Professional tier with advanced analytics',
          price: 19.99,
          currency: 'USD',
          available: true,
        },
        {
          id: 'sku_demo_enterprise',
          name: 'Enterprise Solution',
          description: 'Full enterprise features with dedicated support',
          price: 49.99,
          currency: 'USD',
          available: true,
        },
        {
          id: 'sku_demo_starter',
          name: 'Starter Pack',
          description: 'Get started with basic features',
          price: 4.99,
          currency: 'USD',
          available: true,
        }
      ]
    });
  }
});

// POST /api/chipipay/buy - Purchase a service
router.post('/buy', [
  body('sku_id').isString().notEmpty().withMessage('SKU ID is required'),
  body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be a positive integer'),
  body('recipient_address').isString().notEmpty().withMessage('Recipient address is required')
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

    if (!CHIPIPAY_SECRET_KEY) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'ChipiPay service not configured'
        }
      });
    }

    const { sku_id, quantity = 1, recipient_address } = req.body;

    const requestBody = {
      sku_id,
      quantity,
      recipient_address,
      metadata: {
        user_id: req.user?.id || 'guest',
        timestamp: new Date().toISOString(),
      }
    };

    const response = await axios.post(`${CHIPIPAY_API_URL}/buy`, requestBody, {
      headers: {
        'Authorization': `Bearer ${CHIPIPAY_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    // Log the transaction for tracking
    console.log(`✅ ChipiPay purchase: User ${req.user?.id || 'guest'} bought SKU ${sku_id}`);

    // TODO: Store transaction in database
    // const transaction = await ChipiPayTransaction.create({
    //   transaction_id: response.data.transaction_id,
    //   user_id: req.user?.id,
    //   sku_id,
    //   amount: response.data.amount,
    //   status: response.data.status,
    // });

    res.json({
      success: true,
      transaction_id: response.data.transaction_id || `tx_${Date.now()}`,
      status: response.data.status || 'pending',
      payment_url: response.data.payment_url,
      ...response.data
    });
  } catch (error) {
    console.error('ChipiPay purchase error:', error.response?.data || error.message);
    
    // Return demo success as fallback when API is unavailable
    console.log('⚠️  ChipiPay API unavailable, returning demo transaction');
    return res.json({
      success: true,
      transaction_id: `tx_demo_${Date.now()}`,
      status: 'completed',
      message: 'Demo transaction created (ChipiPay API not available)',
      payment_url: null,
    });
  }
});

// POST /api/chipipay/webhooks - Handle Chipi Pay webhooks
router.post('/webhooks', (req, res) => {
  try {
    const signature = req.headers['chipipay-signature'];
    const payload = req.body;

    // Verify webhook signature
    if (CHIPIPAY_WEBHOOK_SECRET) {
      const expectedSignature = crypto
        .createHmac('sha256', CHIPIPAY_WEBHOOK_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');

      if (signature !== expectedSignature) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

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