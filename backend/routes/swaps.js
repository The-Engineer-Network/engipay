const express = require('express');
const router = express.Router();
const Swap = require('../models/Swap');
const SwapQuote = require('../models/SwapQuote');
const { authenticateToken } = require('../middleware/auth');
const { swapRateLimit, quoteRateLimit } = require('../middleware/rateLimit');
const { validateSwapInitiate } = require('../middleware/validation');
const atomiqService = require('../services/atomiqService');

// Get swap quotes
router.get('/quotes', quoteRateLimit, authenticateToken, async (req, res) => {
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

    // Get fresh quote from Atomiq
    const quote = await atomiqService.getQuote(fromToken, toToken, amount);

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
router.post('/initiate', swapRateLimit, authenticateToken, validateSwapInitiate, async (req, res) => {
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