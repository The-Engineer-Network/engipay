const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { ethers } = require('ethers');
const { User } = require('../models');
const { redisClient } = require('../server') || null;

const router = express.Router();

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

    // Store nonce in Redis with expiration
    const nonceKey = `nonce_${wallet_address}`;
    const nonceData = JSON.stringify({
      nonce,
      expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
    });

    if (redisClient) {
      await redisClient.setEx(nonceKey, 300, nonceData); // 5 minutes expiration
    } else {
      // Fallback to in-memory if Redis not available
      global.nonceStore = global.nonceStore || new Map();
      global.nonceStore.set(nonceKey, JSON.parse(nonceData));
    }

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
    let storedNonce = null;

    if (redisClient) {
      const nonceData = await redisClient.get(nonceKey);
      storedNonce = nonceData ? JSON.parse(nonceData) : null;
    } else {
      storedNonce = global.nonceStore?.get(nonceKey);
    }

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
    if (redisClient) {
      await redisClient.del(nonceKey);
    } else {
      global.nonceStore?.delete(nonceKey);
    }

    // Find or create user in database
    let user = await User.findOne({
      where: { wallet_address: wallet_address.toLowerCase() }
    });

    if (!user) {
      // Create new user
      user = await User.create({
        wallet_address: wallet_address.toLowerCase(),
        kyc_status: 'pending',
        settings: {
          notifications: {
            email: true,
            push: true,
            sms: false,
            marketing: false
          },
          currency: 'USD',
          language: 'en',
          theme: 'auto',
          timezone: 'UTC'
        }
      });
    } else {
      // Update last login
      await user.update({ last_login: new Date() });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        walletAddress: user.wallet_address
      },
      process.env.JWT_SECRET || 'your-super-secure-jwt-secret-key-change-this-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );

    // Return user data and token
    res.json({
      token,
      user: {
        id: user.id,
        wallet_address: user.wallet_address,
        created_at: user.created_at,
        last_login: user.last_login,
        kyc_status: user.kyc_status,
        settings: user.settings
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
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'your-refresh-token-secret-key-change-this-too');

    // Verify user still exists
    const user = await User.findByPk(decoded.userId);
    if (!user || user.wallet_address !== decoded.walletAddress) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'User not found or token invalid'
        }
      });
    }

    // Generate new access token
    const newToken = jwt.sign(
      {
        userId: user.id,
        walletAddress: user.wallet_address
      },
      process.env.JWT_SECRET || 'your-super-secure-jwt-secret-key-change-this-in-production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
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