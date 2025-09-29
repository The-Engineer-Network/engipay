const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');

const router = express.Router();

// In-memory user store (replace with database in production)
const users = new Map();

// Auth-specific rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many authentication attempts, please try again later.'
});

// POST /api/auth/nonce
router.post('/nonce', authLimiter, [
  body('wallet_address').isEthereumAddress().withMessage('Invalid wallet address')
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

    const { wallet_address } = req.body;

    // Generate a unique nonce
    const nonce = `Sign this message to authenticate: ${Date.now()}-${Math.random().toString(36).substring(2)}`;

    // Store nonce temporarily (in production, use Redis or database)
    const nonceKey = `nonce_${wallet_address}`;
    global.nonceStore = global.nonceStore || new Map();
    global.nonceStore.set(nonceKey, {
      nonce,
      expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    });

    res.json({
      nonce,
      expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString()
    });

  } catch (error) {
    console.error('Nonce generation error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to generate nonce'
      }
    });
  }
});

// POST /api/auth/verify
router.post('/verify', authLimiter, [
  body('wallet_address').isEthereumAddress().withMessage('Invalid wallet address'),
  body('signature').isString().notEmpty().withMessage('Signature is required'),
  body('nonce').isString().notEmpty().withMessage('Nonce is required')
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

    const { wallet_address, signature, nonce } = req.body;

    // Verify nonce exists and hasn't expired
    const nonceKey = `nonce_${wallet_address}`;
    const storedNonce = global.nonceStore?.get(nonceKey);

    if (!storedNonce || storedNonce.nonce !== nonce || storedNonce.expiresAt < Date.now()) {
      return res.status(401).json({
        error: {
          code: 'INVALID_NONCE',
          message: 'Invalid or expired nonce'
        }
      });
    }

    // Verify signature
    try {
      const message = nonce;
      const recoveredAddress = ethers.verifyMessage(message, signature);

      if (recoveredAddress.toLowerCase() !== wallet_address.toLowerCase()) {
        return res.status(401).json({
          error: {
            code: 'INVALID_SIGNATURE',
            message: 'Signature verification failed'
          }
        });
      }
    } catch (error) {
      return res.status(401).json({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Invalid signature format'
        }
      });
    }

    // Clear used nonce
    global.nonceStore.delete(nonceKey);

    // Find or create user
    let user = users.get(wallet_address.toLowerCase());
    if (!user) {
      user = {
        id: `user_${Date.now()}_${Math.random().toString(36).substring(2)}`,
        wallet_address: wallet_address.toLowerCase(),
        created_at: new Date().toISOString(),
        last_login: new Date().toISOString(),
        kyc_status: 'pending',
        settings: {
          notifications: true,
          currency: 'USD',
          language: 'en'
        }
      };
      users.set(wallet_address.toLowerCase(), user);
    } else {
      user.last_login = new Date().toISOString();
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        walletAddress: user.wallet_address
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    // Return user data and token
    const { id, wallet_address: walletAddress, created_at, last_login, kyc_status, settings } = user;

    res.json({
      token,
      user: {
        id,
        wallet_address: walletAddress,
        created_at,
        last_login,
        kyc_status,
        settings
      }
    });

  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication failed'
      }
    });
  }
});

// POST /api/auth/refresh
router.post('/refresh', [
  body('token').isString().notEmpty().withMessage('Token is required')
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

    const { token: refreshToken } = req.body;

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET || 'your-secret-key');

    // Generate new access token
    const newToken = jwt.sign(
      {
        userId: decoded.userId,
        walletAddress: decoded.walletAddress
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    res.json({
      token: newToken
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      }
    });
  }
});

module.exports = router;