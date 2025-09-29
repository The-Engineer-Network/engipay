const express = require('express');

const router = express.Router();

// POST /api/webhooks/transaction-update
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

module.exports = router;