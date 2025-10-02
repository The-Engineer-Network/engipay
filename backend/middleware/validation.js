const Joi = require('joi');

const swapInitiateSchema = Joi.object({
  fromToken: Joi.string().valid('BTC', 'ETH', 'STRK', 'USDT', 'USDC').required(),
  toToken: Joi.string().valid('BTC', 'ETH', 'STRK', 'USDT', 'USDC').required(),
  amount: Joi.number().positive().required(),
  expectedOutput: Joi.number().positive().required(),
  slippage: Joi.number().min(0).max(50).default(0.5),
  txHash: Joi.string().required(),
  atomiqSwapId: Joi.string().required(),
  walletAddress: Joi.string().required()
});

const validateSwapInitiate = (req, res, next) => {
  const { error } = swapInitiateSchema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

module.exports = {
  validateSwapInitiate
};