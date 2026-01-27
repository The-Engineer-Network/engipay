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

// GET /api/swap/atomiq/quote - Get swap quote
router.get('/atomiq/quote', authenticateToken, [
  body('from_token').isIn(['BTC', 'STRK']).withMessage('Invalid from token'),
  body('to_token').isIn(['BTC', 'STRK']).withMessage('Invalid to token'),
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('exact_in').optional().isBoolean().withMessage('exact_in must be boolean'),
  body('destination_address').isString().notEmpty().withMessage('Destination address is required')
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

    const { from_token, to_token, amount, exact_in = true, destination_address } = req.query;

    // Validate swap direction
    if (from_token === to_token) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SWAP',
          message: 'Cannot swap same token'
        }
      });
    }

    let quote;

    if (from_token === 'BTC' && to_token === 'STRK') {
      // BTC -> STRK swap
      quote = await atomiqService.getSwapQuote(amount, exact_in, destination_address);
    } else if (from_token === 'STRK' && to_token === 'BTC') {
      // STRK -> BTC swap
      const source_address = req.user.walletAddress;
      quote = await atomiqService.getSwapQuoteReverse(amount, exact_in, source_address, destination_address);
    } else {
      return res.status(400).json({
        error: {
          code: 'UNSUPPORTED_SWAP',
          message: 'Only BTC <-> STRK swaps are supported'
        }
      });
    }

    res.json(quote);

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

// POST /api/swap/atomiq/execute - Execute swap
router.post('/atomiq/execute', authenticateToken, [
  body('swap_id').isString().notEmpty().withMessage('Swap ID is required'),
  body('from_token').isIn(['BTC', 'STRK']).withMessage('Invalid from token'),
  body('bitcoin_wallet').optional().isObject().withMessage('Bitcoin wallet must be object'),
  body('starknet_wallet').optional().isObject().withMessage('StarkNet wallet must be object')
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

    const { swap_id, from_token, bitcoin_wallet, starknet_wallet } = req.body;

    // Create transaction record
    const transactionId = `atomiq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    const transaction = await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'cross_chain_swap',
      description: `Atomiq swap ${from_token} to ${from_token === 'BTC' ? 'STRK' : 'BTC'}`,
      status: 'pending',
      metadata: {
        atomiq_swap_id: swap_id,
        from_token,
        to_token: from_token === 'BTC' ? 'STRK' : 'BTC',
        initiated_at: new Date().toISOString()
      }
    });

    // Set up callbacks for swap events
    const callbacks = {
      onSourceTransactionSent: async (txId) => {
        await transaction.update({
          tx_hash: txId,
          status: 'submitted',
          metadata: {
            ...transaction.metadata,
            source_tx_hash: txId,
            source_tx_sent_at: new Date().toISOString()
          }
        });
      },
      onSourceTransactionConfirmationStatus: async (txId, confirmations, targetConfirmations, txEtaMs) => {
        await transaction.update({
          confirmations,
          metadata: {
            ...transaction.metadata,
            target_confirmations: targetConfirmations,
            estimated_completion: new Date(Date.now() + txEtaMs).toISOString()
          }
        });
      },
      onSourceTransactionConfirmed: async (txId) => {
        await transaction.update({
          status: 'confirmed',
          metadata: {
            ...transaction.metadata,
            source_confirmed_at: new Date().toISOString()
          }
        });
      },
      onSwapSettled: async (destinationTxId) => {
        await transaction.update({
          status: 'completed',
          metadata: {
            ...transaction.metadata,
            destination_tx_hash: destinationTxId,
            settled_at: new Date().toISOString()
          }
        });
      }
    };

    let result;

    if (from_token === 'BTC') {
      // Execute BTC -> STRK swap
      if (!bitcoin_wallet) {
        return res.status(400).json({
          error: {
            code: 'MISSING_WALLET',
            message: 'Bitcoin wallet is required for BTC -> STRK swap'
          }
        });
      }
      result = await atomiqService.executeSwap(swap_id, bitcoin_wallet, callbacks);
    } else {
      // Execute STRK -> BTC swap
      if (!starknet_wallet) {
        return res.status(400).json({
          error: {
            code: 'MISSING_WALLET',
            message: 'StarkNet wallet is required for STRK -> BTC swap'
          }
        });
      }
      result = await atomiqService.executeSwapReverse(swap_id, starknet_wallet, callbacks);
    }

    res.json({
      transaction_id: transactionId,
      ...result
    });

  } catch (error) {
    console.error('Atomiq execute error:', error);
    res.status(500).json({
      error: {
        code: 'EXECUTION_ERROR',
        message: 'Failed to execute swap',
        details: error.message
      }
    });
  }
});

// GET /api/swap/atomiq/:swapId/status - Get swap status
router.get('/atomiq/:swapId/status', authenticateToken, async (req, res) => {
  try {
    const { swapId } = req.params;

    const status = await atomiqService.getSwapStatus(swapId);

    res.json(status);

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
