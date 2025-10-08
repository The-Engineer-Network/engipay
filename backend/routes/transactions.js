const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { Transaction, User } = require('../models');
const { Op } = require('sequelize');

const router = express.Router();

// GET /api/transactions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      limit = 20,
      offset = 0,
      type,
      status,
      asset,
      network,
      start_date,
      end_date
    } = req.query;

    // Build where clause
    const whereClause = {
      user_id: req.user.id
    };

    if (type) whereClause.transaction_type = type;
    if (status) whereClause.status = status;
    if (asset) whereClause.asset_symbol = asset;
    if (network) whereClause.network = network;

    // Date range filter
    if (start_date || end_date) {
      whereClause.created_at = {};
      if (start_date) whereClause.created_at[Op.gte] = new Date(start_date);
      if (end_date) whereClause.created_at[Op.lte] = new Date(end_date);
    }

    const { count, rows: transactions } = await Transaction.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
      attributes: [
        'transaction_id',
        'transaction_type',
        'description',
        'amount',
        'asset_symbol',
        'value_usd',
        'status',
        'created_at',
        'updated_at',
        'tx_hash',
        'network',
        'to_address',
        'from_address',
        'fee_amount',
        'fee_asset',
        'gas_used',
        'gas_price',
        'block_number',
        'confirmations'
      ]
    });

    res.json({
      transactions: transactions.map(tx => ({
        id: tx.transaction_id,
        type: tx.transaction_type,
        description: tx.description,
        amount: tx.amount.toString(),
        asset: tx.asset_symbol,
        value_usd: tx.value_usd ? parseFloat(tx.value_usd) : null,
        status: tx.status,
        timestamp: tx.created_at.toISOString(),
        tx_hash: tx.tx_hash,
        network: tx.network,
        to_address: tx.to_address,
        from_address: tx.from_address,
        fee: tx.fee_amount ? tx.fee_amount.toString() : null,
        fee_asset: tx.fee_asset,
        gas_used: tx.gas_used,
        gas_price: tx.gas_price,
        block_number: tx.block_number,
        confirmations: tx.confirmations
      })),
      total_count: count,
      has_more: parseInt(offset) + parseInt(limit) < count
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
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      where: {
        transaction_id: req.params.id,
        user_id: req.user.id
      },
      attributes: [
        'transaction_id',
        'transaction_type',
        'description',
        'amount',
        'asset_symbol',
        'value_usd',
        'status',
        'created_at',
        'updated_at',
        'tx_hash',
        'network',
        'to_address',
        'from_address',
        'fee_amount',
        'fee_asset',
        'gas_used',
        'gas_price',
        'block_number',
        'confirmations',
        'error_message',
        'metadata'
      ]
    });

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found'
        }
      });
    }

    res.json({
      id: transaction.transaction_id,
      type: transaction.transaction_type,
      description: transaction.description,
      amount: transaction.amount.toString(),
      asset: transaction.asset_symbol,
      value_usd: transaction.value_usd ? parseFloat(transaction.value_usd) : null,
      status: transaction.status,
      timestamp: transaction.created_at.toISOString(),
      tx_hash: transaction.tx_hash,
      network: transaction.network,
      to_address: transaction.to_address,
      from_address: transaction.from_address,
      fee: transaction.fee_amount ? transaction.fee_amount.toString() : null,
      fee_asset: transaction.fee_asset,
      gas_used: transaction.gas_used,
      gas_price: transaction.gas_price,
      block_number: transaction.block_number,
      confirmations: transaction.confirmations,
      error_message: transaction.error_message,
      metadata: transaction.metadata
    });
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
router.post('/send', authenticateToken, [
  body('to_address').isString().notEmpty().withMessage('Recipient address is required'),
  body('asset').isString().notEmpty().withMessage('Asset symbol is required'),
  body('amount').isFloat({ min: 0.00000001 }).withMessage('Amount must be greater than 0'),
  body('network').optional().isIn(['ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin']).withMessage('Invalid network'),
  body('gas_price').optional().isFloat({ min: 0 }).withMessage('Invalid gas price'),
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

    const { to_address, asset, amount, network = 'ethereum', gas_price, memo } = req.body;

    // Generate transaction ID
    const transactionId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create transaction record in database
    const transaction = await Transaction.create({
      transaction_id: transactionId,
      user_id: req.user.id,
      transaction_type: 'send',
      description: memo || `Send ${amount} ${asset}`,
      amount: parseFloat(amount),
      asset_symbol: asset,
      status: 'pending',
      network: network,
      to_address: to_address,
      from_address: req.user.walletAddress,
      gas_price: gas_price ? parseFloat(gas_price) : null,
      metadata: {
        initiated_at: new Date().toISOString(),
        user_agent: req.headers['user-agent'],
        ip_address: req.ip
      }
    });

    // TODO: Here you would integrate with actual blockchain/wallet
    // For now, we'll simulate the transaction hash
    const mockTxHash = `0x${Math.random().toString(16).substring(2, 66)}`;

    // Update transaction with hash
    await transaction.update({
      tx_hash: mockTxHash,
      status: 'submitted'
    });

    // TODO: Start monitoring transaction status
    // This would typically involve:
    // 1. Submitting to blockchain
    // 2. Starting confirmation monitoring
    // 3. Updating status as confirmations come in

    res.json({
      transaction_id: transaction.transaction_id,
      tx_hash: transaction.tx_hash,
      status: transaction.status,
      estimated_completion: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 minutes
      network: transaction.network,
      amount: transaction.amount.toString(),
      asset: transaction.asset_symbol,
      to_address: transaction.to_address
    });
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