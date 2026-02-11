const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const escrowService = require('../services/escrowService');
const { Transaction } = require('../models');
const crypto = require('crypto');

const router = express.Router();

/**
 * POST /api/escrow/create - Create escrow payment request
 */
router.post('/create', authenticateToken, [
  body('to_address').isString().notEmpty().withMessage('Recipient address is required'),
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('asset').isString().notEmpty().withMessage('Asset is required'),
  body('expiry_hours').optional().isInt({ min: 1, max: 720 }).withMessage('Expiry must be between 1 and 720 hours'),
  body('memo').optional().isString().isLength({ max: 500 }).withMessage('Memo too long')
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

    const { to_address, amount, asset, expiry_hours = 24, memo } = req.body;
    const from_address = req.user?.walletAddress;

    if (!from_address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Create escrow request
    const result = await escrowService.createEscrowRequest({
      fromAddress: from_address,
      toAddress: to_address,
      amount,
      asset,
      expiryHours: expiry_hours,
      memo
    });

    // Generate payment link and QR code
    const paymentLink = escrowService.generatePaymentLink(result.request_id);
    const qrCodeData = escrowService.generateQRCodeData({
      request_id: result.request_id,
      amount,
      asset,
      to_address,
      from_address,
      expiry_timestamp: result.expiry_timestamp
    });

    // Create transaction record in database
    const transactionId = `escrow_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'escrow_create',
      description: memo || `Escrow request: ${amount} ${asset}`,
      amount: parseFloat(amount),
      asset_symbol: asset,
      status: 'pending_signature',
      network: 'starknet',
      to_address: to_address,
      from_address: from_address,
      metadata: {
        escrow_request_id: result.request_id,
        expiry_hours,
        initiated_at: new Date().toISOString()
      }
    });

    console.log(`📨 Escrow request created: ${result.request_id}`);

    res.json({
      success: true,
      request_id: result.request_id,
      transaction_id: transactionId,
      payment_link: paymentLink,
      qr_code_data: qrCodeData,
      from_address,
      to_address,
      amount,
      asset,
      expiry_hours,
      expires_at: new Date(result.expiry_timestamp * 1000).toISOString(),
      memo,
      transaction_data: result.transaction_data,
      requires_signature: true,
      instructions: result.instructions
    });
  } catch (error) {
    console.error('Create escrow request error:', error);
    res.status(500).json({
      error: {
        code: 'ESCROW_CREATE_FAILED',
        message: 'Failed to create escrow request',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/escrow/accept - Accept escrow payment request
 */
router.post('/accept', authenticateToken, [
  body('request_id').isString().notEmpty().withMessage('Request ID is required')
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

    const { request_id } = req.body;
    const recipient_address = req.user?.walletAddress;

    if (!recipient_address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Check if request exists and is valid
    try {
      const request = await escrowService.getPaymentRequest(request_id);
      
      // Verify user is the recipient
      if (request.recipient.toLowerCase() !== recipient_address.toLowerCase()) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not the recipient of this payment request'
          }
        });
      }

      // Check if already accepted/rejected
      if (request.status !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'INVALID_STATUS',
            message: `Payment request is ${request.status}, cannot accept`
          }
        });
      }

      // Check if expired
      const isExpired = await escrowService.isRequestExpired(request_id);
      if (isExpired) {
        return res.status(400).json({
          error: {
            code: 'REQUEST_EXPIRED',
            message: 'Payment request has expired'
          }
        });
      }
    } catch (error) {
      // If contract not deployed, allow preparation
      console.warn('Could not verify request on-chain:', error.message);
    }

    // Accept payment request
    const result = await escrowService.acceptPaymentRequest(request_id, recipient_address);

    // Create transaction record
    const transactionId = `escrow_accept_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'escrow_accept',
      description: `Accept escrow payment: ${request_id}`,
      status: 'pending_signature',
      network: 'starknet',
      from_address: recipient_address,
      metadata: {
        escrow_request_id: request_id,
        action: 'accept',
        initiated_at: new Date().toISOString()
      }
    });

    console.log(`✅ Escrow accept prepared: ${request_id}`);

    res.json({
      success: true,
      request_id,
      transaction_id: transactionId,
      action: 'accept',
      transaction_data: result.transaction_data,
      requires_signature: true,
      instructions: result.instructions
    });
  } catch (error) {
    console.error('Accept escrow request error:', error);
    res.status(500).json({
      error: {
        code: 'ESCROW_ACCEPT_FAILED',
        message: 'Failed to accept escrow request',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/escrow/reject - Reject escrow payment request
 */
router.post('/reject', authenticateToken, [
  body('request_id').isString().notEmpty().withMessage('Request ID is required')
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

    const { request_id } = req.body;
    const recipient_address = req.user?.walletAddress;

    if (!recipient_address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Check if request exists and is valid
    try {
      const request = await escrowService.getPaymentRequest(request_id);
      
      // Verify user is the recipient
      if (request.recipient.toLowerCase() !== recipient_address.toLowerCase()) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not the recipient of this payment request'
          }
        });
      }

      // Check if already accepted/rejected
      if (request.status !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'INVALID_STATUS',
            message: `Payment request is ${request.status}, cannot reject`
          }
        });
      }
    } catch (error) {
      // If contract not deployed, allow preparation
      console.warn('Could not verify request on-chain:', error.message);
    }

    // Reject payment request
    const result = await escrowService.rejectPaymentRequest(request_id, recipient_address);

    // Create transaction record
    const transactionId = `escrow_reject_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'escrow_reject',
      description: `Reject escrow payment: ${request_id}`,
      status: 'pending_signature',
      network: 'starknet',
      from_address: recipient_address,
      metadata: {
        escrow_request_id: request_id,
        action: 'reject',
        initiated_at: new Date().toISOString()
      }
    });

    console.log(`❌ Escrow reject prepared: ${request_id}`);

    res.json({
      success: true,
      request_id,
      transaction_id: transactionId,
      action: 'reject',
      transaction_data: result.transaction_data,
      requires_signature: true,
      instructions: result.instructions
    });
  } catch (error) {
    console.error('Reject escrow request error:', error);
    res.status(500).json({
      error: {
        code: 'ESCROW_REJECT_FAILED',
        message: 'Failed to reject escrow request',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/escrow/cancel - Cancel escrow payment request (by sender)
 */
router.post('/cancel', authenticateToken, [
  body('request_id').isString().notEmpty().withMessage('Request ID is required')
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

    const { request_id } = req.body;
    const sender_address = req.user?.walletAddress;

    if (!sender_address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Check if request exists and is valid
    try {
      const request = await escrowService.getPaymentRequest(request_id);
      
      // Verify user is the sender
      if (request.sender.toLowerCase() !== sender_address.toLowerCase()) {
        return res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not the sender of this payment request'
          }
        });
      }

      // Check if already accepted/rejected
      if (request.status !== 'pending') {
        return res.status(400).json({
          error: {
            code: 'INVALID_STATUS',
            message: `Payment request is ${request.status}, cannot cancel`
          }
        });
      }
    } catch (error) {
      // If contract not deployed, allow preparation
      console.warn('Could not verify request on-chain:', error.message);
    }

    // Cancel payment request
    const result = await escrowService.cancelPaymentRequest(request_id, sender_address);

    // Create transaction record
    const transactionId = `escrow_cancel_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'escrow_cancel',
      description: `Cancel escrow payment: ${request_id}`,
      status: 'pending_signature',
      network: 'starknet',
      from_address: sender_address,
      metadata: {
        escrow_request_id: request_id,
        action: 'cancel',
        initiated_at: new Date().toISOString()
      }
    });

    console.log(`🚫 Escrow cancel prepared: ${request_id}`);

    res.json({
      success: true,
      request_id,
      transaction_id: transactionId,
      action: 'cancel',
      transaction_data: result.transaction_data,
      requires_signature: true,
      instructions: result.instructions
    });
  } catch (error) {
    console.error('Cancel escrow request error:', error);
    res.status(500).json({
      error: {
        code: 'ESCROW_CANCEL_FAILED',
        message: 'Failed to cancel escrow request',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/escrow/requests - Get user's escrow requests
 */
router.get('/requests', authenticateToken, [
  query('type').optional().isIn(['sent', 'received', 'all']).withMessage('Invalid type')
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

    const { type = 'all' } = req.query;
    const user_address = req.user?.walletAddress;

    if (!user_address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Get user's requests
    const requests = await escrowService.getUserRequests(user_address, type);

    console.log(`🔍 Fetched ${requests.length} ${type} requests for ${user_address}`);

    res.json({
      success: true,
      requests,
      count: requests.length,
      type,
      user_address
    });
  } catch (error) {
    console.error('Get escrow requests error:', error);
    res.status(500).json({
      error: {
        code: 'ESCROW_FETCH_FAILED',
        message: 'Failed to fetch escrow requests',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/escrow/requests/pending - Get pending escrow requests
 */
router.get('/requests/pending', authenticateToken, async (req, res) => {
  try {
    const user_address = req.user?.walletAddress;

    if (!user_address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Get pending requests
    const requests = await escrowService.getPendingRequests(user_address);

    console.log(`🔍 Fetched ${requests.length} pending requests for ${user_address}`);

    res.json({
      success: true,
      requests,
      count: requests.length,
      user_address
    });
  } catch (error) {
    console.error('Get pending requests error:', error);
    res.status(500).json({
      error: {
        code: 'ESCROW_FETCH_FAILED',
        message: 'Failed to fetch pending requests',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/escrow/request/:id - Get specific escrow request
 */
router.get('/request/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get request details
    const request = await escrowService.getPaymentRequest(id);

    // Generate payment link
    const paymentLink = escrowService.generatePaymentLink(id);

    console.log(`🔍 Fetched request: ${id}`);

    res.json({
      success: true,
      request: {
        ...request,
        payment_link: paymentLink
      }
    });
  } catch (error) {
    console.error('Get escrow request error:', error);
    
    if (error.message.includes('not initialized')) {
      return res.status(503).json({
        error: {
          code: 'CONTRACT_NOT_DEPLOYED',
          message: 'Escrow contract not deployed yet'
        }
      });
    }

    res.status(404).json({
      error: {
        code: 'REQUEST_NOT_FOUND',
        message: 'Escrow request not found',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/escrow/execute - Execute signed escrow transaction
 */
router.post('/execute', authenticateToken, [
  body('transaction_id').isString().notEmpty().withMessage('Transaction ID is required'),
  body('tx_hash').isString().notEmpty().withMessage('Transaction hash is required'),
  body('action').isIn(['create', 'accept', 'reject', 'cancel']).withMessage('Invalid action')
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

    const { transaction_id, tx_hash, action } = req.body;

    // Find transaction in database
    const transaction = await Transaction.findOne({
      where: {
        transaction_id,
        user_id: req.user.id
      }
    });

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found'
        }
      });
    }

    // Update transaction with hash
    await transaction.update({
      tx_hash: tx_hash,
      status: 'pending',
      metadata: {
        ...transaction.metadata,
        executed_at: new Date().toISOString()
      }
    });

    console.log(`✅ Escrow ${action} executed: ${transaction_id}, hash: ${tx_hash}`);

    res.json({
      success: true,
      transaction_id,
      tx_hash,
      action,
      status: 'pending',
      explorer_url: `https://starkscan.co/tx/${tx_hash}`,
      message: `Escrow ${action} transaction submitted successfully`
    });
  } catch (error) {
    console.error('Execute escrow transaction error:', error);
    res.status(500).json({
      error: {
        code: 'EXECUTION_FAILED',
        message: 'Failed to execute escrow transaction',
        details: error.message
      }
    });
  }
});

module.exports = router;
