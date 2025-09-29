const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Mock transactions data
const mockTransactions = [
  {
    id: 'tx_123',
    type: 'payment',
    description: 'Payment to merchant',
    amount: '0.1',
    asset: 'ETH',
    value_usd: 200.00,
    status: 'completed',
    timestamp: '2024-01-15T10:30:00Z',
    tx_hash: '0x1234...abcd',
    network: 'ethereum',
    to_address: '0xabcd...1234',
    fee: '0.001',
    fee_asset: 'ETH'
  }
];

// GET /api/transactions
router.get('/', authenticateToken, (req, res) => {
  try {
    const { limit = 20, offset = 0, type, status } = req.query;

    let transactions = [...mockTransactions];

    if (type) {
      transactions = transactions.filter(tx => tx.type === type);
    }

    if (status) {
      transactions = transactions.filter(tx => tx.status === status);
    }

    const paginatedTransactions = transactions.slice(offset, offset + limit);

    res.json({
      transactions: paginatedTransactions,
      total_count: transactions.length,
      has_more: offset + limit < transactions.length
    });
  } catch (error) {
    console.error('Transactions fetch error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch transactions'
      }
    });
  }
});

// GET /api/transactions/:id
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const transaction = mockTransactions.find(tx => tx.id === req.params.id);

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found'
        }
      });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Transaction fetch error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch transaction'
      }
    });
  }
});

// POST /api/transactions/send
router.post('/send', authenticateToken, (req, res) => {
  try {
    const { to_address, asset, amount, network, gas_price, memo } = req.body;

    // Mock transaction creation
    const transaction = {
      transaction_id: `tx_${Date.now()}`,
      tx_hash: `0x${Math.random().toString(16).substring(2)}`,
      status: 'pending',
      estimated_completion: new Date(Date.now() + 2 * 60 * 1000).toISOString() // 2 minutes
    };

    res.json(transaction);
  } catch (error) {
    console.error('Transaction send error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to send transaction'
      }
    });
  }
});

module.exports = router;