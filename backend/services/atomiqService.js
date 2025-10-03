const axios = require('axios');

class AtomiqService {
  constructor() {
    this.baseURL = process.env.ATOMIQ_API_URL || 'https://api.atomiq.fi';
    this.apiKey = process.env.ATOMIQ_API_KEY;
  }

  async getQuote(fromToken, toToken, amount) {
    try {
      const response = await axios.get(`${this.baseURL}/quotes`, {
        params: { fromToken, toToken, amount },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        fromToken,
        toToken,
        amount: parseFloat(amount),
        expectedOutput: response.data.expectedOutput,
        fee: response.data.fee,
        slippage: response.data.slippage,
        route: response.data.route,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
      };
    } catch (error) {
      console.error('Atomiq quote error:', error);
      throw new Error('Failed to get swap quote');
    }
  }

  async validateSwap(swapData) {
    // Validate swap parameters before initiation
    const required = ['fromToken', 'toToken', 'amount', 'walletAddress'];
    for (const field of required) {
      if (!swapData[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Additional validation logic
    if (swapData.amount <= 0) {
      throw new Error('Amount must be greater than 0');
    }

    // Check supported token pairs
    const supportedPairs = [
      ['BTC', 'ETH'], ['BTC', 'STRK'], ['ETH', 'BTC'], ['STRK', 'BTC']
    ];

    const pair = [swapData.fromToken, swapData.toToken];
    if (!supportedPairs.some(p => p[0] === pair[0] && p[1] === pair[1])) {
      throw new Error('Unsupported token pair');
    }

    return true;
  }
}

module.exports = new AtomiqService();