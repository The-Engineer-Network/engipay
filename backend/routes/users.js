const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// In-memory user store (replace with database in production)
const users = new Map();

// GET /api/users/profile
router.get('/profile', authenticateToken, (req, res) => {
  try {
    const user = users.get(req.user.walletAddress.toLowerCase());

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User profile not found'
        }
      });
    }

    res.json({
      id: user.id,
      wallet_address: user.wallet_address,
      username: user.username || null,
      email: user.email || null,
      avatar_url: user.avatar_url || null,
      created_at: user.created_at,
      last_login: user.last_login,
      kyc_status: user.kyc_status,
      settings: user.settings
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to fetch user profile'
      }
    });
  }
});

// PUT /api/users/profile
router.put('/profile', authenticateToken, [
  body('username').optional().isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters'),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('avatar_url').optional().isURL().withMessage('Invalid avatar URL')
], (req, res) => {
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

    const user = users.get(req.user.walletAddress.toLowerCase());
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const { username, email, avatar_url } = req.body;

    if (username) user.username = username;
    if (email) user.email = email;
    if (avatar_url) user.avatar_url = avatar_url;

    users.set(req.user.walletAddress.toLowerCase(), user);

    res.json({
      id: user.id,
      wallet_address: user.wallet_address,
      username: user.username,
      email: user.email,
      avatar_url: user.avatar_url,
      created_at: user.created_at,
      last_login: user.last_login,
      kyc_status: user.kyc_status,
      settings: user.settings
    });
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update user profile'
      }
    });
  }
});

// PUT /api/users/settings
router.put('/settings', authenticateToken, [
  body('notifications').optional().isBoolean().withMessage('Notifications must be boolean'),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'JPY']).withMessage('Invalid currency'),
  body('language').optional().isIn(['en', 'es', 'fr', 'de']).withMessage('Invalid language'),
  body('theme').optional().isIn(['light', 'dark', 'auto']).withMessage('Invalid theme'),
  body('two_factor_enabled').optional().isBoolean().withMessage('Two factor must be boolean')
], (req, res) => {
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

    const user = users.get(req.user.walletAddress.toLowerCase());
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const { notifications, currency, language, theme, two_factor_enabled } = req.body;

    if (notifications !== undefined) user.settings.notifications = notifications;
    if (currency) user.settings.currency = currency;
    if (language) user.settings.language = language;
    if (theme) user.settings.theme = theme;
    if (two_factor_enabled !== undefined) user.settings.two_factor_enabled = two_factor_enabled;

    users.set(req.user.walletAddress.toLowerCase(), user);

    res.json({
      settings: user.settings
    });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update user settings'
      }
    });
  }
});

module.exports = router;