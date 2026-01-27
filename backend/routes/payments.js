const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const crypto = require('crypto');

const router = express.Router();

// POST /api/payments/send - Send payment to another wallet
router.post('/send', authenticateToken, [
  body('recipient').isString().notEmpty().withMessage('Recipient address is required'),
  body('asset').isString().notEmpty().withMessage('Asset is required'),
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('network').optional().isString().withMessage('Network must be a string'),
  body('memo').optional().isString().withMessage('Memo must be a string')
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

    const { recipient, asset, amount, memo, network = 'starknet' } = req.body;
    const sender = req.user?.walletAddress;

    if (!sender) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Validate recipient address format
    if (!paymentService.isValidStarknetAddress(recipient)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid Starknet address format'
        }
      });
    }

    // NOTE: In production, you need to get the user's Starknet account
    // This requires the user to sign the transaction on the frontend
    // For now, we'll return instructions for frontend implementation
    
    const transactionId = `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Return transaction data for frontend to sign and execute
    res.json({
      success: true,
      transaction_id: transactionId,
      status: 'pending_signature',
      from: sender,
      to: recipient,
      asset,
      amount,
      network,
      memo,
      // Frontend needs to execute this transaction
      requires_signature: true,
      transaction_data: {
        contract_address: paymentService.getTokenAddress(asset),
        entry_point: 'transfer',
        calldata: {
          recipient,
          amount
        }
      },
      instructions: 'Please sign this transaction in your wallet',
      estimated_completion: new Date(Date.now() + 2 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Payment send error:', error);
    res.status(500).json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Failed to send payment',
        details: error.message
      }
    });
  }
});

// GET /api/payments/requests - Get payment requests for user
router.get('/requests', authenticateToken, async (req, res) => {
  try {
    const userAddress = req.user?.walletAddress;

    if (!userAddress) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // TODO: Fetch from database where requests are stored
    // For now, return empty array since requests should be created on-chain
    // const requests = await PaymentRequest.findAll({
    //   where: { to_address: userAddress, status: 'pending' }
    // });

    res.json({
      success: true,
      requests: [],
      message: 'Payment requests are stored on-chain. Use the request ID to query specific requests.'
    });
  } catch (error) {
    console.error('Fetch payment requests error:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch payment requests'
      }
    });
  }
});

// POST /api/payments/request - Create a payment request
router.post('/request', authenticateToken, [
  body('asset').isString().notEmpty().withMessage('Asset is required'),
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('expires_in_hours').optional().isInt({ min: 1 }).withMessage('Expiry must be positive'),
  body('memo').optional().isString().withMessage('Memo must be a string')
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

    const { asset, amount, memo, expires_in_hours = 24 } = req.body;
    const requester = req.user?.walletAddress;

    if (!requester) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    const requestId = `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + expires_in_hours * 60 * 60 * 1000);

    // Return data for frontend to create on-chain payment request
    const paymentLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pay/${requestId}`;

    console.log(`📨 Payment request created: ${requestId} for ${amount} ${asset}`);

    res.json({
      success: true,
      request_id: requestId,
      payment_link: paymentLink,
      qr_code_data: JSON.stringify({
        type: 'payment_request',
        request_id: requestId,
        asset,
        amount,
        recipient: requester,
        expires_at: expiresAt.toISOString()
      }),
      expires_at: expiresAt.toISOString(),
      asset,
      amount,
      memo,
      // Frontend needs to create this on-chain
      requires_signature: true,
      transaction_data: {
        contract_address: process.env.ESCROW_CONTRACT_ADDRESS,
        entry_point: 'create_payment_request',
        calldata: {
          recipient: requester,
          amount,
          token: paymentService.getTokenAddress(asset),
          expiry_hours: expires_in_hours,
          memo: memo || ''
        }
      },
      instructions: 'Payment request will be created on-chain when you sign'
    });
  } catch (error) {
    console.error('Create payment request error:', error);
    res.status(500).json({
      error: {
        code: 'REQUEST_FAILED',
        message: 'Failed to create payment request'
      }
    });
  }
});

// GET /api/payments/request/:id - Get specific payment request
router.get('/request/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Try to fetch from smart contract
    try {
      const request = await paymentService.getPaymentRequest(id);
      
      res.json({
        success: true,
        request: {
          id,
          from_address: request.sender,
          to_address: request.recipient,
          asset: 'ENGI', // You can map token address to symbol
          amount: paymentService.formatUnits(request.amount.toString(), 18),
          memo: request.memo,
          expires_at: new Date(Number(request.expiry) * 1000).toISOString(),
          status: request.status === 0 ? 'pending' : request.status === 1 ? 'accepted' : 'rejected',
          created_at: new Date().toISOString(),
          on_chain: true
        }
      });
    } catch (error) {
      // If not found on-chain, return not found
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Payment request not found on-chain'
        }
      });
    }
  } catch (error) {
    console.error('Fetch payment request error:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch payment request'
      }
    });
  }
});

// POST /api/payments/merchant - Pay a merchant
router.post('/merchant', authenticateToken, [
  body('merchant_id').isString().notEmpty().withMessage('Merchant ID is required'),
  body('asset').isString().notEmpty().withMessage('Asset is required'),
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('invoice_id').optional().isString().withMessage('Invoice ID must be a string')
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

    const { merchant_id, asset, amount, invoice_id } = req.body;
    const payer = req.user?.walletAddress;

    if (!payer) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    // Validate merchant address
    const merchantAddress = merchant_id.startsWith('0x') ? merchant_id : `0x${merchant_id}`;
    
    if (!paymentService.isValidStarknetAddress(merchantAddress)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ADDRESS',
          message: 'Invalid merchant address format'
        }
      });
    }

    const transactionId = `tx_merchant_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    console.log(`🏪 Merchant payment: ${payer} -> ${merchantAddress}, ${amount} ${asset}`);

    res.json({
      success: true,
      transaction_id: transactionId,
      status: 'pending_signature',
      merchant_id,
      merchant_address: merchantAddress,
      asset,
      amount,
      invoice_id,
      from: payer,
      to: merchantAddress,
      // Frontend needs to execute this transaction
      requires_signature: true,
      transaction_data: {
        contract_address: paymentService.getTokenAddress(asset),
        entry_point: 'transfer',
        calldata: {
          recipient: merchantAddress,
          amount
        }
      },
      instructions: 'Please sign this merchant payment in your wallet',
      estimated_completion: new Date(Date.now() + 2 * 60 * 1000).toISOString()
    });
  } catch (error) {
    console.error('Merchant payment error:', error);
    res.status(500).json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Failed to process merchant payment'
      }
    });
  }
});

// POST /api/payments/execute - Execute a signed transaction
router.post('/execute', authenticateToken, [
  body('tx_hash').isString().notEmpty().withMessage('Transaction hash is required'),
  body('transaction_id').isString().notEmpty().withMessage('Transaction ID is required'),
  body('type').isIn(['send', 'request', 'merchant']).withMessage('Invalid transaction type')
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

    const { tx_hash, transaction_id, type } = req.body;

    console.log(`✅ Transaction executed: ${transaction_id}, hash: ${tx_hash}`);

    // TODO: Store in database
    // await Transaction.create({
    //   transaction_id,
    //   tx_hash,
    //   type,
    //   user_id: req.user?.id,
    //   status: 'pending',
    // });

    res.json({
      success: true,
      transaction_id,
      tx_hash,
      status: 'pending',
      explorer_url: `https://starkscan.co/tx/${tx_hash}`,
      message: 'Transaction submitted successfully'
    });
  } catch (error) {
    console.error('Execute transaction error:', error);
    res.status(500).json({
      error: {
        code: 'EXECUTION_FAILED',
        message: 'Failed to execute transaction'
      }
    });
  }
});

const crypto = require('crypto');

module.exports = router;