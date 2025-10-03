const rateLimit = require('express-rate-limit');

const swapRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 swap requests per windowMs
  message: 'Too many swap requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const quoteRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // limit each IP to 30 quote requests per windowMs
  message: 'Too many quote requests, please try again later',
});

module.exports = {
  swapRateLimit,
  quoteRateLimit
};