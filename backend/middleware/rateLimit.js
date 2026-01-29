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

const supplyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 supply requests per windowMs
  message: 'Too many supply requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const borrowRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 borrow requests per windowMs
  message: 'Too many borrow requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const repayRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 repay requests per windowMs
  message: 'Too many repay requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const withdrawRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 withdraw requests per windowMs
  message: 'Too many withdraw requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

const positionRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 position requests per windowMs
  message: 'Too many position requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  swapRateLimit,
  quoteRateLimit,
  supplyRateLimit,
  borrowRateLimit,
  repayRateLimit,
  withdrawRateLimit,
  positionRateLimit
};