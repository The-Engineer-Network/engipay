const mongoose = require('mongoose');

const swapSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fromToken: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'STRK', 'USDT', 'USDC']
  },
  toToken: {
    type: String,
    required: true,
    enum: ['BTC', 'ETH', 'STRK', 'USDT', 'USDC']
  },
  amount: {
    type: Number,
    required: true
  },
  expectedOutput: {
    type: Number,
    required: true
  },
  actualOutput: {
    type: Number,
    default: null
  },
  fee: {
    type: Number,
    default: 0
  },
  slippage: {
    type: Number,
    default: 0.5
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  txHash: {
    type: String,
    required: true,
    unique: true
  },
  blockchainTxHash: {
    type: String,
    default: null
  },
  atomiqSwapId: {
    type: String,
    required: true
  },
  walletAddress: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('Swap', swapSchema);