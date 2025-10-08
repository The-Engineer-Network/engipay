const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { Transaction } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { Op } = require('sequelize');

// Get swap quotes
router.get('/quotes', authenticateToken, async (req, res) => {
  try {
    const { fromToken, toToken, amount } = req.query;

    if (!fromToken || !toToken || !amount) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required parameters: fromToken, toToken, amount'
        }
      });
    }

    // Import Atomiq SDK for real quotes
    const { getSwapQuote } = await import('../lib/atomiq');

    // Get quote from Atomiq SDK
    const quote = await getSwapQuote({
      fromToken,
      toToken,
      amount,
      slippage: 0.5
    });

    res.json({
      fromToken,
      toToken,
      amount: parseFloat(amount),
      expectedOutput: parseFloat(quote.toAmount),
      fee: parseFloat(quote.fee),
      slippage: quote.slippage,
      exchangeRate: parseFloat(quote.exchangeRate),
      estimatedTime: quote.estimatedTime,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
    });
  } catch (error) {
    console.error('Quote error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get swap quote'
      }
    });
  }
});

// Initiate swap
router.post('/initiate', authenticateToken, [
  body('fromToken').isString().notEmpty().withMessage('From token is required'),
  body('toToken').isString().notEmpty().withMessage('To token is required'),
  body('amount').isFloat({ min: 0.00000001 }).withMessage('Amount must be greater than 0'),
  body('expectedOutput').isFloat({ min: 0 }).withMessage('Expected output is required'),
  body('slippage').optional().isFloat({ min: 0, max: 50 }).withMessage('Invalid slippage'),
  body('txHash').optional().isString().withMessage('Transaction hash must be string'),
  body('atomiqSwapId').optional().isString().withMessage('Atomiq swap ID must be string')
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

    const {
      fromToken,
      toToken,
      amount,
      expectedOutput,
      slippage = 0.5,
      txHash,
      atomiqSwapId
    } = req.body;

    // Generate transaction ID
    const transactionId = `swap_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create transaction record for the swap
    const transaction = await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'swap',
      description: `Swap ${amount} ${fromToken} to ${toToken}`,
      amount: parseFloat(amount),
      asset_symbol: fromToken,
      value_usd: parseFloat(expectedOutput) * 2000, // Rough USD calculation
      status: 'pending',
      network: 'ethereum', // Default network
      from_address: req.user.walletAddress,
      metadata: {
        toToken,
        expectedOutput: parseFloat(expectedOutput),
        slippage: parseFloat(slippage),
        atomiqSwapId,
        initiated_at: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      }
    });

    // If txHash is provided, update the transaction
    if (txHash) {
      await transaction.update({
        tx_hash: txHash,
        status: 'submitted'
      });
    }

    res.status(201).json({
      success: true,
      transaction_id: transaction.transaction_id,
      message: 'Swap initiated successfully'
    });
  } catch (error) {
    console.error('Swap initiation error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to initiate swap'
      }
    });
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