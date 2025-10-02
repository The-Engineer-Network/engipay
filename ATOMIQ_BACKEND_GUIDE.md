# Atomiq SDK Backend Integration Guide

## Overview

This guide provides comprehensive instructions for backend developers to implement Atomiq SDK integration in EngiPay. While Atomiq primarily operates as a frontend SDK, the backend handles transaction tracking, swap history persistence, webhook processing, and provides supporting APIs for cross-chain operations.

### Backend Responsibilities

- **Transaction Tracking**: Store and retrieve swap transaction history
- **Webhook Handling**: Process Atomiq swap confirmations and status updates
- **Quote Management**: Cache and provide swap quotes for better UX
- **Analytics**: Track swap volumes and success rates
- **Security**: Validate transactions and prevent double-spending

## Prerequisites

- Node.js backend with Express.js
- Database (MongoDB/PostgreSQL) for transaction storage
- Atomiq SDK backend library (if available)
- Webhook endpoint accessible from Atomiq services

## 1. Database Schema

### Swap Transaction Model

Create `backend/models/Swap.js`:

```javascript
const mongoose = require('mongoose');

const swapSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fromToken: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'STRK', 'USDT', 'USDC']
  },
  toToken: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'STRK', 'USDT', 'USDC']
  },
  amount: {
    type: Number,
    required: true
  },
  expectedOutput: {
    type: Number,
    required: true
  },
  actualOutput: {
    type: Number,
    default: null
  },
  fee: {
    type: Number,
    default: 0
  },
  slippage: {
    type: Number,
    default: 0.5
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  txHash: {
    type: String,
    required: true,
    unique: true
  },
  blockchainTxHash: {
    type: String,
    default: null
  },
  atomiqSwapId: {
    type: String,
    required: true
  },
  walletAddress: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Swap', swapSchema);
```

### Swap Quote Cache Model

```javascript
const quoteSchema = new mongoose.Schema({
  fromToken: String,
  toToken: String,
  amount: Number,
  quote: Object, // Atomiq quote response
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
  }
});

module.exports = mongoose.model('SwapQuote', quoteSchema);
```

## 2. API Endpoints Implementation

### Swap Routes (`backend/routes/swaps.js`)

```javascript
const express = require('express');
const router = express.Router();
const Swap = require('../models/Swap');
const SwapQuote = require('../models/SwapQuote');
const { authenticateToken } = require('../middleware/auth');

// Get swap quotes
router.get('/quotes', authenticateToken, async (req, res) => {
  try {
    const { fromToken, toToken, amount } = req.query;

    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        error: 'Missing required parameters: fromToken, toToken, amount'
      });
    }

    // Check cache first
    const cachedQuote = await SwapQuote.findOne({
      fromToken,
      toToken,
      amount: parseFloat(amount),
      expiresAt: { $gt: new Date() }
    });

    if (cachedQuote) {
      return res.json(cachedQuote.quote);
    }

    // Get fresh quote from Atomiq (mock implementation)
    const quote = await getAtomiqQuote(fromToken, toToken, amount);

    // Cache the quote
    await SwapQuote.create({
      fromToken,
      toToken,
      amount: parseFloat(amount),
      quote
    });

    res.json(quote);
  } catch (error) {
    console.error('Quote error:', error);
    res.status(500).json({ error: 'Failed to get swap quote' });
  }
});

// Initiate swap
router.post('/initiate', authenticateToken, async (req, res) => {
  try {
    const {
      fromToken,
      toToken,
      amount,
      expectedOutput,
      slippage,
      txHash,
      atomiqSwapId,
      walletAddress
    } = req.body;

    // Validate required fields
    if (!fromToken || !toToken || !amount || !txHash || !atomiqSwapId || !walletAddress) {
      return res.status(400).json({
        error: 'Missing required fields'
      });
    }

    // Create swap record
    const swap = new Swap({
      userId: req.user.id,
      fromToken,
      toToken,
      amount: parseFloat(amount),
      expectedOutput: parseFloat(expectedOutput),
      slippage: parseFloat(slippage) || 0.5,
      txHash,
      atomiqSwapId,
      walletAddress
    });

    await swap.save();

    res.status(201).json({
      success: true,
      swapId: swap._id,
      message: 'Swap initiated successfully'
    });
  } catch (error) {
    console.error('Swap initiation error:', error);
    res.status(500).json({ error: 'Failed to initiate swap' });
  }
});

// Get swap history
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;

    const query = { userId: req.user.id };
    if (status) {
      query.status = status;
    }

    const swaps = await Swap.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .populate('userId', 'username email');

    const total = await Swap.countDocuments(query);

    res.json({
      swaps,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('History fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch swap history' });
  }
});

// Get swap by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const swap = await Swap.findOne({
      _id: req.params.id,
      userId: req.user.id
    });

    if (!swap) {
      return res.status(404).json({ error: 'Swap not found' });
    }

    res.json(swap);
  } catch (error) {
    console.error('Swap fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch swap' });
  }
});

// Update swap status (internal use)
router.put('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status, blockchainTxHash, actualOutput } = req.body;

    const swap = await Swap.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      {
        status,
        blockchainTxHash,
        actualOutput: actualOutput ? parseFloat(actualOutput) : undefined,
        completedAt: status === 'completed' ? new Date() : undefined,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!swap) {
      return res.status(404).json({ error: 'Swap not found' });
    }

    res.json(swap);
  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({ error: 'Failed to update swap status' });
  }
});

module.exports = router;
```

### Webhook Handler (`backend/routes/webhooks.js`)

```javascript
const express = require('express');
const router = express.Router();
const Swap = require('../models/Swap');
const crypto = require('crypto');

// Atomiq webhook secret (set in environment)
const ATOMIQ_WEBHOOK_SECRET = process.env.ATOMIQ_WEBHOOK_SECRET;

// Verify webhook signature
function verifyWebhookSignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', ATOMIQ_WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');

  return signature === expectedSignature;
}

// Handle Atomiq swap webhooks
router.post('/atomiq/swaps', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const payload = JSON.parse(req.body);
    const signature = req.headers['x-atomiq-signature'];

    // Verify webhook authenticity
    if (!verifyWebhookSignature(payload, signature)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const { swapId, status, blockchainTxHash, actualOutput, error } = payload;

    // Find and update swap
    const swap = await Swap.findOne({ atomiqSwapId: swapId });

    if (!swap) {
      return res.status(404).json({ error: 'Swap not found' });
    }

    const updateData = {
      status: mapAtomiqStatus(status),
      updatedAt: new Date()
    };

    if (blockchainTxHash) {
      updateData.blockchainTxHash = blockchainTxHash;
    }

    if (actualOutput) {
      updateData.actualOutput = parseFloat(actualOutput);
    }

    if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    await Swap.findByIdAndUpdate(swap._id, updateData);

    // Trigger notifications or additional processing
    if (status === 'completed') {
      await handleSwapCompletion(swap);
    } else if (status === 'failed') {
      await handleSwapFailure(swap, error);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Map Atomiq status to internal status
function mapAtomiqStatus(atomiqStatus) {
  const statusMap = {
    'pending': 'pending',
    'processing': 'processing',
    'completed': 'completed',
    'failed': 'failed',
    'refunded': 'refunded'
  };

  return statusMap[atomiqStatus] || 'pending';
}

// Handle successful swap completion
async function handleSwapCompletion(swap) {
  // Send notification to user
  // Update portfolio balances
  // Log analytics
  console.log(`Swap ${swap._id} completed successfully`);
}

// Handle swap failure
async function handleSwapFailure(swap, error) {
  // Send failure notification
  // Log error details
  // Trigger refund process if applicable
  console.log(`Swap ${swap._id} failed: ${error}`);
}

module.exports = router;
```

## 3. Helper Functions

### Atomiq Quote Service (`backend/services/atomiqService.js`)

```javascript
const axios = require('axios');

class AtomiqService {
  constructor() {
    this.baseURL = process.env.ATOMIQ_API_URL || 'https://api.atomiq.fi';
    this.apiKey = process.env.ATOMIQ_API_KEY;
  }

  async getQuote(fromToken, toToken, amount) {
    try {
      const response = await axios.get(`${this.baseURL}/quotes`, {
        params: { fromToken, toToken, amount },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        fromToken,
        toToken,
        amount: parseFloat(amount),
        expectedOutput: response.data.expectedOutput,
        fee: response.data.fee,
        slippage: response.data.slippage,
        route: response.data.route,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
      };
    } catch (error) {
      console.error('Atomiq quote error:', error);
      throw new Error('Failed to get swap quote');
    }
  }

  async validateSwap(swapData) {
    // Validate swap parameters before initiation
    const required = ['fromToken', 'toToken', 'amount', 'walletAddress'];
    for (const field of required) {
      if (!swapData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Additional validation logic
    if (swapData.amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Check supported token pairs
    const supportedPairs = [
      ['BTC', 'ETH'], ['BTC', 'STRK'], ['ETH', 'BTC'], ['STRK', 'BTC']
    ];

    const pair = [swapData.fromToken, swapData.toToken];
    if (!supportedPairs.some(p => p[0] === pair[0] && p[1] === pair[1])) {
      throw new Error('Unsupported token pair');
    }

    return true;
  }
}

module.exports = new AtomiqService();
```

## 4. Middleware and Security

### Rate Limiting (`backend/middleware/rateLimit.js`)

```javascript
const rateLimit = require('express-rate-limit');

const swapRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 swap requests per windowMs
  message: 'Too many swap requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const quoteRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // limit each IP to 30 quote requests per windowMs
  message: 'Too many quote requests, please try again later',
});

module.exports = {
  swapRateLimit,
  quoteRateLimit
};
```

### Input Validation (`backend/middleware/validation.js`)

```javascript
const Joi = require('joi');

const swapInitiateSchema = Joi.object({
  fromToken: Joi.string().valid('BTC', 'ETH', 'STRK', 'USDT', 'USDC').required(),
  toToken: Joi.string().valid('BTC', 'ETH', 'STRK', 'USDT', 'USDC').required(),
  amount: Joi.number().positive().required(),
  expectedOutput: Joi.number().positive().required(),
  slippage: Joi.number().min(0).max(50).default(0.5),
  txHash: Joi.string().required(),
  atomiqSwapId: Joi.string().required(),
  walletAddress: Joi.string().required()
});

const validateSwapInitiate = (req, res, next) => {
  const { error } = swapInitiateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

module.exports = {
  validateSwapInitiate
};
```

## 5. Server Configuration

Update `backend/server.js` to include new routes:

```javascript
// ... existing imports
const swapRoutes = require('./routes/swaps');
const webhookRoutes = require('./routes/webhooks');
const { swapRateLimit, quoteRateLimit } = require('./middleware/rateLimit');

// ... existing middleware

// Apply rate limiting
app.use('/api/swaps/initiate', swapRateLimit);
app.use('/api/swaps/quotes', quoteRateLimit);

// Routes
app.use('/api/swaps', swapRoutes);
app.use('/api/webhooks', webhookRoutes);

// ... rest of server config
```

## 6. Environment Variables

Add to `.env`:

```env
ATOMIQ_API_URL=https://api.atomiq.fi
ATOMIQ_API_KEY=your_atomiq_api_key
ATOMIQ_WEBHOOK_SECRET=your_webhook_secret
MONGODB_URI=mongodb://localhost:27017/engipay
```

## 7. API Documentation

### Endpoints Summary

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/swaps/quotes` | Get swap quotes | Yes |
| POST | `/api/swaps/initiate` | Initiate a swap | Yes |
| GET | `/api/swaps/history` | Get swap history | Yes |
| GET | `/api/swaps/:id` | Get swap details | Yes |
| PUT | `/api/swaps/:id/status` | Update swap status | Yes |
| POST | `/api/webhooks/atomiq/swaps` | Atomiq webhook handler | No |

### Request/Response Examples

#### Get Quotes
```bash
GET /api/swaps/quotes?fromToken=BTC&toToken=ETH&amount=0.1
Authorization: Bearer <token>
```

Response:
```json
{
  "fromToken": "BTC",
  "toToken": "ETH",
  "amount": 0.1,
  "expectedOutput": 2.45,
  "fee": 0.001,
  "slippage": 0.5,
  "route": ["BTC", "ETH"],
  "expiresAt": "2023-10-02T07:12:44.978Z"
}
```

#### Initiate Swap
```bash
POST /api/swaps/initiate
Authorization: Bearer <token>
Content-Type: application/json

{
  "fromToken": "BTC",
  "toToken": "ETH",
  "amount": 0.1,
  "expectedOutput": 2.45,
  "slippage": 0.5,
  "txHash": "a1b2c3d4...",
  "atomiqSwapId": "swap_123",
  "walletAddress": "bc1q..."
}
```

Response:
```json
{
  "success": true,
  "swapId": "64f1a2b3c4d5e6f7g8h9i0j1",
  "message": "Swap initiated successfully"
}
```

## 8. Testing and Monitoring

### Unit Tests (`backend/tests/swaps.test.js`)

```javascript
const request = require('supertest');
const app = require('../server');
const Swap = require('../models/Swap');

describe('Swaps API', () => {
  beforeEach(async () => {
    await Swap.deleteMany({});
  });

  describe('POST /api/swaps/initiate', () => {
    it('should initiate a swap successfully', async () => {
      const response = await request(app)
        .post('/api/swaps/initiate')
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

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });
});
```

### Monitoring

- Implement logging for all swap operations
- Set up alerts for failed swaps
- Monitor API response times
- Track webhook delivery success rates

## 9. Deployment Considerations

- Ensure webhook endpoint is HTTPS and publicly accessible
- Set up proper database indexing on swap queries
- Implement database backups for transaction data
- Consider Redis for quote caching in production
- Set up monitoring and alerting for swap failures

## Resources

- Atomiq SDK Documentation: https://docs.atomiq.fi
- Express.js Documentation: https://expressjs.com/
- MongoDB Documentation: https://docs.mongodb.com/

## Support

For Atomiq-specific issues, refer to their documentation or contact their support team.