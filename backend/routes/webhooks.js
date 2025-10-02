const express = require('express');
const router = express.Router();
const Swap = require('../models/Swap');
const crypto = require('crypto');

// Atomiq webhook secret (set in environment)
const ATOMIQ_WEBHOOK_SECRET = process.env.ATOMIQ_WEBHOOK_SECRET;

// Verify webhook signature
function verifyWebhookSignature(payload, signature) {
  if (!ATOMIQ_WEBHOOK_SECRET) {
    console.warn('ATOMIQ_WEBHOOK_SECRET not set - skipping signature verification');
    return true;
  }

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

// Keep existing webhook endpoints for backward compatibility
router.post('/transaction-update', (req, res) => {
  try {
    const { tx_hash, status, block_number, gas_used, confirmations } = req.body;

    console.log('Transaction update webhook:', { tx_hash, status, block_number });

    // TODO: Update transaction status in database
    // TODO: Send notification to user
    // TODO: Update user balance

    res.json({ received: true });
  } catch (error) {
    console.error('Transaction webhook error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_PROCESSING_ERROR',
        message: 'Failed to process transaction webhook'
      }
    });
  }
});

// POST /api/webhooks/price-update
router.post('/price-update', (req, res) => {
  try {
    const { asset, price_usd, change_24h, timestamp } = req.body;

    console.log('Price update webhook:', { asset, price_usd, change_24h });

    // TODO: Update price data in cache/database
    // TODO: Trigger portfolio revaluation if needed

    res.json({ received: true });
  } catch (error) {
    console.error('Price webhook error:', error);
    res.status(500).json({
      error: {
        code: 'WEBHOOK_PROCESSING_ERROR',
        message: 'Failed to process price webhook'
      }
    });
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