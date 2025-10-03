const mongoose = require('mongoose');

const quoteSchema = new mongoose.Schema({
  fromToken: String,
  toToken: String,
  amount: Number,
  quote: Object, // Atomiq quote response
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
  }
});

module.exports = mongoose.model('SwapQuote', quoteSchema);