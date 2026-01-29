const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { Transaction } = require('../models');
const atomiqAdapterService = require('../services/atomiqAdapterService');

const router = express.Router();

/**
 * AtomiqAdapter Smart Contract Routes
 * Handles interaction with the AtomiqAdapter contract on StarkNet
 */

// POST /api/atomiq-adapter/initiate-swap - Initiate STRK -> BTC swap via smart contract
router.post('/initiate-swap', authenticateToken, [
  body('strkAmount').isNumeric().withMessage('STRK amount must be numeric'),
  body('bitcoinAddress').isString().notEmpty().withMessage('Bitcoin address is required'),
  body('minBtcAmount').isNumeric().withMessage('Minimum BTC amount must be numeric')
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

    const { strkAmount, bitcoinAddress, minBtcAmount } = req.body;

    // Validate amounts
    if (parseFloat(strkAmount) <= 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AMOUNT',
          message: 'STRK amount must be greater than 0'
        }
      });
    }

    if (parseFloat(minBtcAmount) <= 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AMOUNT',
          message: 'Minimum BTC amount must be greater than 0'
        }
      });
    }

    // Validate Bitcoin address format (basic validation)
    if (!bitcoinAddress.match(/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$|^bc1[a-z0-9]{39,59}$/)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid Bitcoin address format'
        }
      });
    }

    console.log('Initiating STRK -> BTC swap via AtomiqAdapter contract:');
    console.log('  User:', req.user.walletAddress);
    console.log('  STRK Amount:', strkAmount);
    console.log('  Bitcoin Address:', bitcoinAddress);
    console.log('  Min BTC Amount:', minBtcAmount);

    // Initiate swap via smart contract
    const swapResult = await atomiqAdapterService.initiateStrkToBtcSwap(
      strkAmount,
      bitcoinAddress,
      minBtcAmount
    );

    // Create transaction record in database
    const transaction = await Transaction.create({
      transaction_id: `atomiq_adapter_${swapResult.swapId}`,
      user_id: req.user.id,
      transaction_type: 'cross_chain_swap',
      description: `AtomiqAdapter STRK -> BTC swap`,
      status: 'pending',
      tx_hash: swapResult.transactionHash,
      metadata: {
        swap_id: swapResult.swapId,
        from_token: 'STRK',
        to_token: 'BTC',
        from_amount: strkAmount,
        to_amount: minBtcAmount,
        bitcoin_address: bitcoinAddress,
        contract_address: process.env.ATOMIQ_ADAPTER_CONTRACT_ADDRESS,
        initiated_at: new Date().toISOString()
      }
    });

    res.json({
      success: true,
      swap: {
        id: swapResult.swapId,
        transactionId: transaction.transaction_id,
        fromToken: 'STRK',
        toToken: 'BTC',
        fromAmount: strkAmount,
        toAmount: minBtcAmount,
        status: 'pending',
        txHash: swapResult.transactionHash,
        bitcoinAddress: bitcoinAddress,
        createdAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('AtomiqAdapter initiate swap error:', error);
    res.status(500).json({
      error: {
        code: 'SWAP_INITIATION_ERROR',
        message: 'Failed to initiate swap via AtomiqAdapter',
        details: error.message
      }
    });
  }
});

// GET /api/atomiq-adapter/swap/:swapId - Get swap details from smart contract
router.get('/swap/:swapId', authenticateToken, async (req, res) => {
  try {
    const { swapId } = req.params;

    if (!swapId || isNaN(swapId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_SWAP_ID',
          message: 'Invalid swap ID'
        }
      });
    }

    const swap = await atomiqAdapterService.getSwap(swapId);

    res.json({
      swap: swap
    });

  } catch (error) {
    console.error('AtomiqAdapter get swap error:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: {
          code: 'SWAP_NOT_FOUND',
          message: 'Swap not found'
        }
      });
    }

    res.status(500).json({
      error: {
        code: 'SWAP_FETCH_ERROR',
        message: 'Failed to fetch swap details',
        details: error.message
      }
    });
  }
});

// GET /api/atomiq-adapter/user-swaps - Get user's swaps from smart contract
router.get('/user-swaps', authenticateToken, async (req, res) => {
  try {
    const userAddress = req.user.walletAddress;

    if (!userAddress) {
      return res.status(400).json({
        error: {
          code: 'NO_WALLET_ADDRESS',
          message: 'User wallet address not found'
        }
      });
    }

    const swaps = await atomiqAdapterService.getUserSwaps(userAddress);

    res.json({
      swaps: swaps,
      total: swaps.length
    });

  } catch (error) {
    console.error('AtomiqAdapter get user swaps error:', error);
    res.status(500).json({
      error: {
        code: 'USER_SWAPS_ERROR',
        message: 'Failed to fetch user swaps',
        details: error.message
      }
    });
  }
});

// POST /api/atomiq-adapter/confirm-swap - Confirm swap (admin only)
router.post('/confirm-swap', authenticateToken, [
  body('swapId').isNumeric().withMessage('Swap ID must be numeric'),
  body('txHash').isString().notEmpty().withMessage('Transaction hash is required')
], async (req, res) => {
  try {
    // Check if user is admin (you may want to implement proper role checking)
    if (!req.user.isAdmin) {
      return res.status(403).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Admin access required'
        }
      });
    }

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

    const { swapId, txHash } = req.body;

    const result = await atomiqAdapterService.confirmSwap(swapId, txHash);

    // Update database record
    await Transaction.update(
      { 
        status: 'confirmed',
        metadata: {
          ...req.body,
          confirmed_at: new Date().toISOString()
        }
      },
      { 
        where: { 
          transaction_id: `atomiq_adapter_${swapId}` 
        } 
      }
    );

    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    console.error('AtomiqAdapter confirm swap error:', error);
    res.status(500).json({
      error: {
        code: 'SWAP_CONFIRMATION_ERROR',
        message: 'Failed to confirm swap',
        details: error.message
      }
    });
  }
});

// POST /api/atomiq-adapter/complete-swap - Complete swap (admin only)
router.post('/complete-swap', authenticateToken, [
  body('swapId').isNumeric().withMessage('Swap ID must be numeric'),
  body('bitcoinTxHash').isString().notEmpty().withMessage('Bitcoin transaction hash is required')
], async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Admin access required'
        }
      });
    }

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

    const { swapId, bitcoinTxHash } = req.body;

    const result = await atomiqAdapterService.completeSwap(swapId, bitcoinTxHash);

    // Update database record
    await Transaction.update(
      { 
        status: 'completed',
        metadata: {
          ...req.body,
          completed_at: new Date().toISOString(),
          bitcoin_tx_hash: bitcoinTxHash
        }
      },
      { 
        where: { 
          transaction_id: `atomiq_adapter_${swapId}` 
        } 
      }
    );

    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    console.error('AtomiqAdapter complete swap error:', error);
    res.status(500).json({
      error: {
        code: 'SWAP_COMPLETION_ERROR',
        message: 'Failed to complete swap',
        details: error.message
      }
    });
  }
});

// POST /api/atomiq-adapter/refund-swap - Refund swap
router.post('/refund-swap', authenticateToken, [
  body('swapId').isNumeric().withMessage('Swap ID must be numeric')
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

    const { swapId } = req.body;

    // Verify user owns this swap or is admin
    const swap = await atomiqAdapterService.getSwap(swapId);
    if (swap.user !== req.user.walletAddress && !req.user.isAdmin) {
      return res.status(403).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'You can only refund your own swaps'
        }
      });
    }

    const result = await atomiqAdapterService.refundSwap(swapId);

    // Update database record
    await Transaction.update(
      { 
        status: 'refunded',
        metadata: {
          ...req.body,
          refunded_at: new Date().toISOString()
        }
      },
      { 
        where: { 
          transaction_id: `atomiq_adapter_${swapId}` 
        } 
      }
    );

    res.json({
      success: true,
      result: result
    });

  } catch (error) {
    console.error('AtomiqAdapter refund swap error:', error);
    res.status(500).json({
      error: {
        code: 'SWAP_REFUND_ERROR',
        message: 'Failed to refund swap',
        details: error.message
      }
    });
  }
});

// GET /api/atomiq-adapter/stats - Get contract statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const totalSwaps = await atomiqAdapterService.getSwapCount();

    // Get additional stats from database
    const dbStats = await Transaction.findAll({
      where: {
        transaction_type: 'cross_chain_swap',
        transaction_id: {
          [require('sequelize').Op.like]: 'atomiq_adapter_%'
        }
      },
      attributes: [
        'status',
        [require('sequelize').fn('COUNT', '*'), 'count']
      ],
      group: ['status']
    });

    const statusCounts = {};
    dbStats.forEach(stat => {
      statusCounts[stat.status] = parseInt(stat.get('count'));
    });

    res.json({
      totalSwaps: totalSwaps,
      statusBreakdown: statusCounts,
      contractAddress: process.env.ATOMIQ_ADAPTER_CONTRACT_ADDRESS
    });

  } catch (error) {
    console.error('AtomiqAdapter stats error:', error);
    res.status(500).json({
      error: {
        code: 'STATS_ERROR',
        message: 'Failed to fetch contract statistics',
        details: error.message
      }
    });
  }
});

module.exports = router;