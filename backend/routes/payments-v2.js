const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const paymentService = require('../services/paymentService');
const blockchainService = require('../services/blockchainService');
const { Transaction } = require('../models');
const crypto = require('crypto');

const router = express.Router();

/**
 * POST /api/payments/v2/send - Send payment with real blockchain transaction
 * This endpoint prepares transaction data for frontend signing
 */
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

    const transactionId = `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const tokenAddress = paymentService.getTokenAddress(asset);

    // Create pending transaction in database
    await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'send',
      description: memo || `Send ${amount} ${asset} to ${recipient.substring(0, 10)}...`,
      amount: parseFloat(amount),
      asset_symbol: asset,
      status: 'pending_signature',
      network: network,
      to_address: recipient,
      from_address: sender,
      metadata: {
        initiated_at: new Date().toISOString(),
        user_agent: req.headers['user-agent']
      }
    });

    console.log(`💸 Payment prepared: ${sender} -> ${recipient}, ${amount} ${asset}`);

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
      requires_signature: true,
      transaction_data: {
        contract_address: tokenAddress,
        entry_point: 'transfer',
        calldata: {
          recipient,
          amount
        }
      },
      instructions: 'Please sign this transaction in your wallet'
    });
  } catch (error) {
    console.error('Payment send error:', error);
    res.status(500).json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Failed to prepare payment',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/payments/v2/execute - Execute signed transaction
 * This endpoint receives the signed transaction hash from frontend
 */
router.post('/execute', authenticateToken, [
  body('transaction_id').isString().notEmpty().withMessage('Transaction ID is required'),
  body('tx_hash').isString().notEmpty().withMessage('Transaction hash is required'),
  body('type').optional().isIn(['send', 'request', 'merchant']).withMessage('Invalid transaction type')
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

    const { transaction_id, tx_hash, type = 'send' } = req.body;

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

    console.log(`✅ Transaction executed: ${transaction_id}, hash: ${tx_hash}`);

    // Start monitoring transaction status in background
    monitorTransactionStatus(tx_hash, transaction_id, req.user.id);

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
        message: 'Failed to execute transaction',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/payments/v2/request - Create payment request
 */
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
    const paymentLink = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/pay/${requestId}`;

    // Create QR code data
    const qrData = {
      type: 'payment_request',
      request_id: requestId,
      asset,
      amount,
      recipient: requester,
      expires_at: expiresAt.toISOString()
    };

    console.log(`📨 Payment request created: ${requestId} for ${amount} ${asset}`);

    res.json({
      success: true,
      request_id: requestId,
      payment_link: paymentLink,
      qr_code_data: JSON.stringify(qrData),
      expires_at: expiresAt.toISOString(),
      asset,
      amount,
      memo,
      recipient: requester,
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
        message: 'Failed to create payment request',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/payments/v2/requests - Get payment requests for user
 */
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

    // TODO: Fetch from smart contract
    // For now, return empty array with instructions
    res.json({
      success: true,
      requests: [],
      message: 'Payment requests are stored on-chain. Use the request ID to query specific requests.',
      instructions: 'Implement smart contract integration to fetch requests'
    });
  } catch (error) {
    console.error('Fetch payment requests error:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to fetch payment requests',
        details: error.message
      }
    });
  }
});

/**
 * POST /api/payments/v2/merchant - Pay a merchant
 */
router.post('/merchant', authenticateToken, [
  body('merchant_id').isString().notEmpty().withMessage('Merchant ID is required'),
  body('asset').isString().notEmpty().withMessage('Asset is required'),
  body('amount').isString().notEmpty().withMessage('Amount is required'),
  body('invoice_id').optional().isString().withMessage('Invoice ID must be a string'),
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

    const { merchant_id, asset, amount, invoice_id, memo } = req.body;
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
    const tokenAddress = paymentService.getTokenAddress(asset);

    // Create pending transaction in database
    await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'merchant_payment',
      description: memo || `Merchant payment: ${amount} ${asset}${invoice_id ? ` (Invoice: ${invoice_id})` : ''}`,
      amount: parseFloat(amount),
      asset_symbol: asset,
      status: 'pending_signature',
      network: 'starknet',
      to_address: merchantAddress,
      from_address: payer,
      metadata: {
        merchant_id,
        invoice_id,
        initiated_at: new Date().toISOString()
      }
    });

    console.log(`🏪 Merchant payment prepared: ${payer} -> ${merchantAddress}, ${amount} ${asset}`);

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
      requires_signature: true,
      transaction_data: {
        contract_address: tokenAddress,
        entry_point: 'transfer',
        calldata: {
          recipient: merchantAddress,
          amount
        }
      },
      instructions: 'Please sign this merchant payment in your wallet'
    });
  } catch (error) {
    console.error('Merchant payment error:', error);
    res.status(500).json({
      error: {
        code: 'PAYMENT_FAILED',
        message: 'Failed to process merchant payment',
        details: error.message
      }
    });
  }
});

/**
 * GET /api/payments/v2/balance - Get token balance
 */
router.get('/balance', authenticateToken, async (req, res) => {
  try {
    const { asset = 'ENGI' } = req.query;
    const address = req.user?.walletAddress;

    if (!address) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Wallet address not found'
        }
      });
    }

    const balance = await paymentService.getBalance(address, asset);

    res.json({
      success: true,
      address,
      asset,
      balance,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({
      error: {
        code: 'BALANCE_FETCH_FAILED',
        message: 'Failed to fetch balance',
        details: error.message
      }
    });
  }
});

/**
 * Background function to monitor transaction status
 * @param {string} txHash - Transaction hash
 * @param {string} transactionId - Internal transaction ID
 * @param {number} userId - User ID
 */
async function monitorTransactionStatus(txHash, transactionId, userId) {
  try {
    // Wait for transaction confirmation (max 5 minutes)
    const maxAttempts = 30;
    const delayMs = 10000; // 10 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));

      try {
        const status = await blockchainService.getTransactionStatus(txHash, 'starknet');

        // Update transaction in database
        const transaction = await Transaction.findOne({
          where: { transaction_id: transactionId, user_id: userId }
        });

        if (transaction) {
          await transaction.update({
            status: status.status,
            confirmations: status.confirmations,
            block_number: status.block_number,
            gas_used: status.gas_used
          });

          // If confirmed or failed, stop monitoring
          if (status.status === 'confirmed' || status.status === 'failed') {
            console.log(`✅ Transaction ${transactionId} ${status.status}`);
            break;
          }
        }
      } catch (error) {
        console.error(`Error monitoring transaction ${transactionId}:`, error.message);
      }
    }
  } catch (error) {
    console.error('Monitor transaction error:', error);
  }
}

module.exports = router;
