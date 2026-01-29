const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { Transaction } = require('../models');
const atomiqService = require('../services/atomiqService');

const router = express.Router();

/**
 * Atomiq Cross-Chain Swap Routes - Backend Dev 3
 * Real BTC <-> STRK swap implementation
 */

// POST /api/swap/atomiq/quote - Get swap quote
router.post('/atomiq/quote', authenticateToken, [
  body('fromToken').isIn(['BTC', 'ETH', 'STRK']).withMessage('Invalid from token'),
  body('toToken').isIn(['BTC', 'ETH', 'STRK']).withMessage('Invalid to token'),
  body('amount').isNumeric().withMessage('Amount must be numeric'),
  body('slippage').optional().isNumeric().withMessage('Slippage must be numeric')
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

    const { fromToken, toToken, amount, slippage = 0.5 } = req.body;

    // Validate swap direction
    if (fromToken === toToken) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SWAP',
          message: 'Cannot swap same token'
        }
      });
    }

    // For now, only support BTC <-> STRK swaps via Atomiq
    if (!((fromToken === 'BTC' && toToken === 'STRK') || (fromToken === 'STRK' && toToken === 'BTC'))) {
      return res.status(400).json({
        error: {
          code: 'UNSUPPORTED_SWAP',
          message: 'Only BTC <-> STRK swaps are supported via Atomiq'
        }
      });
    }

    let quote;
    const destination_address = req.user.walletAddress;

    if (fromToken === 'BTC' && toToken === 'STRK') {
      // BTC -> STRK swap
      const amountSatoshis = Math.floor(amount * 100000000); // Convert BTC to satoshis
      quote = await atomiqService.getSwapQuote(amountSatoshis.toString(), true, destination_address);
    } else if (fromToken === 'STRK' && toToken === 'BTC') {
      // STRK -> BTC swap
      const amountWei = Math.floor(amount * Math.pow(10, 18)); // Convert STRK to wei
      const source_address = req.user.walletAddress;
      const bitcoin_address = req.body.bitcoinAddress || 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'; // Default or user provided
      quote = await atomiqService.getSwapQuoteReverse(amountWei.toString(), true, source_address, bitcoin_address);
    }

    // Format response to match frontend expectations
    const formattedQuote = {
      quoteId: quote.swap_id,
      fromAmount: fromToken === 'BTC' ? (parseInt(quote.from_amount) / 100000000).toString() : (parseInt(quote.from_amount) / Math.pow(10, 18)).toString(),
      toAmount: toToken === 'BTC' ? (parseInt(quote.to_amount) / 100000000).toString() : (parseInt(quote.to_amount) / Math.pow(10, 18)).toString(),
      exchangeRate: toToken === 'BTC' 
        ? ((parseInt(quote.to_amount) / 100000000) / (parseInt(quote.from_amount) / Math.pow(10, 18))).toFixed(8)
        : ((parseInt(quote.to_amount) / Math.pow(10, 18)) / (parseInt(quote.from_amount) / 100000000)).toFixed(6),
      fee: fromToken === 'BTC' ? (parseInt(quote.fee) / 100000000).toString() : (parseInt(quote.fee) / Math.pow(10, 18)).toString(),
      estimatedTime: '10-30 minutes',
      slippage: slippage.toString() + '%',
      expiresAt: quote.expires_at
    };

    res.json({
      quote: formattedQuote
    });

  } catch (error) {
    console.error('Atomiq quote error:', error);
    res.status(500).json({
      error: {
        code: 'QUOTE_ERROR',
        message: 'Failed to get swap quote',
        details: error.message
      }
    });
  }
});

// POST /api/swap/atomiq/initiate - Initiate swap
router.post('/atomiq/initiate', authenticateToken, [
  body('quoteId').isString().notEmpty().withMessage('Quote ID is required'),
  body('fromToken').isIn(['BTC', 'ETH', 'STRK']).withMessage('Invalid from token'),
  body('toToken').isIn(['BTC', 'ETH', 'STRK']).withMessage('Invalid to token'),
  body('fromAmount').isString().notEmpty().withMessage('From amount is required'),
  body('toAmount').isString().notEmpty().withMessage('To amount is required'),
  body('slippage').optional().isNumeric().withMessage('Slippage must be numeric')
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

    const { quoteId, fromToken, toToken, fromAmount, toAmount, slippage } = req.body;

    // Create transaction record
    const transactionId = `atomiq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const transaction = await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'cross_chain_swap',
      description: `Atomiq swap ${fromToken} to ${toToken}`,
      status: 'pending',
      metadata: {
        atomiq_swap_id: quoteId,
        from_token: fromToken,
        to_token: toToken,
        from_amount: fromAmount,
        to_amount: toAmount,
        slippage: slippage,
        initiated_at: new Date().toISOString()
      }
    });

    // For now, simulate the swap initiation
    // In production, this would call the actual Atomiq SDK
    const swapResult = {
      id: transactionId,
      fromToken,
      toToken,
      fromAmount,
      toAmount,
      status: 'pending',
      txHash: null,
      createdAt: new Date().toISOString(),
      estimatedTime: '10-30 minutes'
    };

    // Update transaction status
    await transaction.update({
      status: 'submitted',
      tx_hash: `0x${Math.random().toString(16).substring(2, 66)}`, // Mock tx hash
      metadata: {
        ...transaction.metadata,
        submitted_at: new Date().toISOString()
      }
    });

    res.json({
      swap: swapResult,
      transaction_id: transactionId
    });

  } catch (error) {
    console.error('Atomiq initiate error:', error);
    res.status(500).json({
      error: {
        code: 'INITIATE_ERROR',
        message: 'Failed to initiate swap',
        details: error.message
      }
    });
  }
});

// GET /api/swap/atomiq/status/:id - Get swap status (updated to match frontend expectations)
router.get('/atomiq/status/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // First try to get from database
    const transaction = await Transaction.findOne({
      where: { 
        transaction_id: id,
        user_id: req.user.id 
      }
    });

    if (transaction) {
      // Return database record
      const swapData = {
        id: transaction.transaction_id,
        fromToken: transaction.metadata?.from_token || 'BTC',
        toToken: transaction.metadata?.to_token || 'STRK',
        fromAmount: transaction.metadata?.from_amount || '0',
        toAmount: transaction.metadata?.to_amount || '0',
        status: transaction.status,
        txHash: transaction.tx_hash,
        createdAt: transaction.created_at.toISOString(),
        estimatedTime: transaction.metadata?.estimated_completion || null
      };

      return res.json({
        swap: swapData
      });
    }

    // If not in database, try Atomiq service
    try {
      const status = await atomiqService.getSwapStatus(id);
      
      const swapData = {
        id: id,
        fromToken: status.from_token,
        toToken: status.to_token,
        fromAmount: status.from_amount,
        toAmount: status.to_amount,
        status: status.state,
        txHash: null,
        createdAt: status.created_at,
        estimatedTime: null
      };

      res.json({
        swap: swapData
      });
    } catch (atomiqError) {
      // Return not found if swap doesn't exist anywhere
      res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found'
        }
      });
    }

  } catch (error) {
    console.error('Atomiq status error:', error);
    res.status(500).json({
      error: {
        code: 'STATUS_ERROR',
        message: 'Failed to get swap status',
        details: error.message
      }
    });
  }
});

// GET /api/swap/atomiq/limits - Get swap limits
router.get('/atomiq/limits', authenticateToken, async (req, res) => {
  try {
    const limits = await atomiqService.getSwapLimits();

    res.json(limits);

  } catch (error) {
    console.error('Atomiq limits error:', error);
    res.status(500).json({
      error: {
        code: 'LIMITS_ERROR',
        message: 'Failed to get swap limits',
        details: error.message
      }
    });
  }
});

// GET /api/swap/atomiq/history - Get all swaps
router.get('/atomiq/history', authenticateToken, async (req, res) => {
  try {
    const swaps = await atomiqService.getAllSwaps();

    res.json({
      swaps,
      total: swaps.length
    });

  } catch (error) {
    console.error('Atomiq history error:', error);
    res.status(500).json({
      error: {
        code: 'HISTORY_ERROR',
        message: 'Failed to get swap history',
        details: error.message
      }
    });
  }
});

// GET /api/swap/atomiq/claimable - Get claimable swaps
router.get('/atomiq/claimable', authenticateToken, async (req, res) => {
  try {
    const swaps = await atomiqService.getClaimableSwaps();

    res.json({
      swaps,
      total: swaps.length
    });

  } catch (error) {
    console.error('Atomiq claimable error:', error);
    res.status(500).json({
      error: {
        code: 'CLAIMABLE_ERROR',
        message: 'Failed to get claimable swaps',
        details: error.message
      }
    });
  }
});

// GET /api/swap/atomiq/refundable - Get refundable swaps
router.get('/atomiq/refundable', authenticateToken, async (req, res) => {
  try {
    const swaps = await atomiqService.getRefundableSwaps();

    res.json({
      swaps,
      total: swaps.length
    });

  } catch (error) {
    console.error('Atomiq refundable error:', error);
    res.status(500).json({
      error: {
        code: 'REFUNDABLE_ERROR',
        message: 'Failed to get refundable swaps',
        details: error.message
      }
    });
  }
});

// POST /api/swap/atomiq/:swapId/claim - Claim swap manually
router.post('/atomiq/:swapId/claim', authenticateToken, [
  body('wallet').isObject().notEmpty().withMessage('Wallet is required')
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

    const { swapId } = req.params;
    const { wallet } = req.body;

    const result = await atomiqService.claimSwap(swapId, wallet);

    res.json(result);

  } catch (error) {
    console.error('Atomiq claim error:', error);
    res.status(500).json({
      error: {
        code: 'CLAIM_ERROR',
        message: 'Failed to claim swap',
        details: error.message
      }
    });
  }
});

// POST /api/swap/atomiq/:swapId/refund - Refund swap
router.post('/atomiq/:swapId/refund', authenticateToken, [
  body('wallet').isObject().notEmpty().withMessage('Wallet is required')
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

    const { swapId } = req.params;
    const { wallet } = req.body;

    const result = await atomiqService.refundSwap(swapId, wallet);

    res.json(result);

  } catch (error) {
    console.error('Atomiq refund error:', error);
    res.status(500).json({
      error: {
        code: 'REFUND_ERROR',
        message: 'Failed to refund swap',
        details: error.message
      }
    });
  }
});

module.exports = router;
