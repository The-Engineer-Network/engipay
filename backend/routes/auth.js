const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

// JWT Secret (should be in environment variables)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user with email and password
 * @access  Public
 */
router.post(
  '/signup',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          error: errors.array()[0].msg,
          errors: errors.array() 
        });
      }

      const { email, password } = req.body;

      // Check if user already exists
      const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
      if (existingUser) {
        return res.status(400).json({ error: 'User with this email already exists' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Generate unique referral code
      const referralCode = `ENGI${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      // Create user
      const user = await User.create({
        email: email.toLowerCase(),
        password: hashedPassword,
        referral_code: referralCode,
        is_active: true,
        is_email_verified: false,
        kyc_status: 'pending',
      });

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user.id, 
          email: user.email 
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      // Return user data (without password)
      res.status(201).json({
        message: 'User created successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          referral_code: user.referral_code,
          is_email_verified: user.is_email_verified,
          kyc_status: user.kyc_status,
          created_at: user.createdAt,
        },
      });
    } catch (error) {
      console.error('Signup error:', error);
      res.status(500).json({ error: 'Server error during signup' });
    }
  }
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user with email and password
 * @access  Public
 */
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  async (req, res) => {
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          error: errors.array()[0].msg,
          errors: errors.array() 
        });
      }

      const { email, password } = req.body;

      // Find user by email
      const user = await User.findOne({ where: { email: email.toLowerCase() } });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if user has a password (might be wallet-only user)
      if (!user.password) {
        return res.status(401).json({ 
          error: 'This account uses wallet authentication. Please connect your wallet instead.' 
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Check if account is active
      if (!user.is_active) {
        return res.status(403).json({ error: 'Account is deactivated. Please contact support.' });
      }

      // Update last login
      await user.update({
        last_login: new Date(),
        login_count: user.login_count + 1,
      });

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user.id, 
          email: user.email,
          wallet_address: user.wallet_address 
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      // Return user data (without password)
      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          wallet_address: user.wallet_address,
          wallet_type: user.wallet_type,
          first_name: user.first_name,
          last_name: user.last_name,
          avatar_url: user.avatar_url,
          is_email_verified: user.is_email_verified,
          kyc_status: user.kyc_status,
          referral_code: user.referral_code,
          settings: user.settings,
          created_at: user.createdAt,
          last_login: user.last_login,
        },
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Server error during login' });
    }
  }
);

/**
 * @route   POST /api/auth/wallet-connect
 * @desc    Connect wallet and create/login user
 * @access  Public
 */
router.post(
  '/wallet-connect',
  [
    body('wallet_address').notEmpty().withMessage('Wallet address is required'),
    body('wallet_type').isIn(['metamask', 'argent', 'braavos', 'xverse', 'walletconnect'])
      .withMessage('Invalid wallet type'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          error: errors.array()[0].msg,
          errors: errors.array() 
        });
      }

      const { wallet_address, wallet_type } = req.body;

      // Find or create user by wallet address
      let user = await User.findOne({ 
        where: { wallet_address: wallet_address.toLowerCase() } 
      });

      if (!user) {
        // Create new user with wallet
        const referralCode = `ENGI${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        
        user = await User.create({
          wallet_address: wallet_address.toLowerCase(),
          wallet_type,
          referral_code: referralCode,
          is_active: true,
          kyc_status: 'pending',
        });
      } else {
        // Update existing user
        await user.update({
          wallet_type,
          last_login: new Date(),
          login_count: user.login_count + 1,
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { 
          userId: user.id, 
          wallet_address: user.wallet_address,
          wallet_type: user.wallet_type
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      res.json({
        message: user.createdAt === user.updatedAt ? 'Wallet connected and user created' : 'Wallet connected',
        token,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          wallet_address: user.wallet_address,
          wallet_type: user.wallet_type,
          first_name: user.first_name,
          last_name: user.last_name,
          avatar_url: user.avatar_url,
          is_email_verified: user.is_email_verified,
          kyc_status: user.kyc_status,
          referral_code: user.referral_code,
          settings: user.settings,
          created_at: user.createdAt,
        },
      });
    } catch (error) {
      console.error('Wallet connect error:', error);
      res.status(500).json({ error: 'Server error during wallet connection' });
    }
  }
);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail().withMessage('Valid email is required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          error: errors.array()[0].msg 
        });
      }

      const { email } = req.body;

      const user = await User.findOne({ where: { email: email.toLowerCase() } });
      
      // Always return success to prevent email enumeration
      if (!user) {
        return res.json({ 
          message: 'If an account exists with this email, a password reset link has been sent.' 
        });
      }

      // Generate reset token (valid for 1 hour)
      const resetToken = jwt.sign(
        { userId: user.id, email: user.email, type: 'password-reset' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      // TODO: Send email with reset link
      // For now, just return the token (in production, send via email)
      console.log('Password reset token:', resetToken);
      console.log('Reset link:', `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`);

      res.json({ 
        message: 'If an account exists with this email, a password reset link has been sent.',
        // Remove this in production - only for development
        resetToken: process.env.NODE_ENV === 'development' ? resetToken : undefined
      });
    } catch (error) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
      .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          error: errors.array()[0].msg 
        });
      }

      const { token, password } = req.body;

      // Verify token
      let decoded;
      try {
        decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'password-reset') {
          throw new Error('Invalid token type');
        }
      } catch (err) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      // Find user
      const user = await User.findByPk(decoded.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Update password
      await user.update({ password: hashedPassword });

      res.json({ message: 'Password reset successful. You can now login with your new password.' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        wallet_address: user.wallet_address,
        wallet_type: user.wallet_type,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: user.avatar_url,
        bio: user.bio,
        is_email_verified: user.is_email_verified,
        kyc_status: user.kyc_status,
        referral_code: user.referral_code,
        referral_count: user.referral_count,
        settings: user.settings,
        social_links: user.social_links,
        created_at: user.createdAt,
        last_login: user.last_login,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (client-side token removal)
 * @access  Private
 */
router.post('/logout', authenticateToken, async (req, res) => {
  // In a JWT-based system, logout is primarily handled client-side
  // by removing the token. This endpoint is for logging purposes.
  res.json({ message: 'Logout successful' });
});

module.exports = router;
