const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('../middleware/auth');
const { User } = require('../models');

const router = express.Router();

// GET /api/users/profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({
      where: { wallet_address: req.user.walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User profile not found'
        }
      });
    }

    // Update last login
    await user.update({ last_login: new Date() });

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

    const user = await User.findOne({
      where: { wallet_address: req.user.walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const { username, email, avatar_url } = req.body;
    const updateData = {};

    if (username) updateData.username = username;
    if (email) updateData.email = email;
    if (avatar_url) updateData.avatar_url = avatar_url;

    await user.update(updateData);

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
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH']).withMessage('Invalid currency'),
  body('language').optional().isIn(['en', 'es', 'fr', 'de', 'zh', 'ja']).withMessage('Invalid language'),
  body('theme').optional().isIn(['light', 'dark', 'auto']).withMessage('Invalid theme'),
  body('timezone').optional().isString().withMessage('Timezone must be string'),
  body('two_factor_enabled').optional().isBoolean().withMessage('Two factor must be boolean')
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

    const user = await User.findOne({
      where: { wallet_address: req.user.walletAddress.toLowerCase() }
    });

    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const { notifications, currency, language, theme, timezone, two_factor_enabled } = req.body;
    const currentSettings = user.settings || {};

    const updatedSettings = {
      ...currentSettings,
      notifications: notifications !== undefined ? notifications : currentSettings.notifications,
      currency: currency || currentSettings.currency,
      language: language || currentSettings.language,
      theme: theme || currentSettings.theme,
      timezone: timezone || currentSettings.timezone
    };

    await user.update({
      settings: updatedSettings,
      two_factor_enabled: two_factor_enabled !== undefined ? two_factor_enabled : user.two_factor_enabled
    });

    res.json({
      settings: updatedSettings
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