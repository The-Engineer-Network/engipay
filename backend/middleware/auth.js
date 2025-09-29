const jwt = require('jsonwebtoken');

/**
 * Middleware to authenticate JWT tokens
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: {
        code: 'NO_TOKEN',
        message: 'Access token is required'
      }
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.user = {
      id: decoded.userId,
      walletAddress: decoded.walletAddress
    };
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      }
    });
  }
};

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
      req.user = {
        id: decoded.userId,
        walletAddress: decoded.walletAddress
      };
    } catch (error) {
      // Silently ignore invalid tokens for optional auth
      console.warn('Optional auth token invalid:', error.message);
    }
  }

  next();
};

module.exports = {
  authenticateToken,
  optionalAuth
};