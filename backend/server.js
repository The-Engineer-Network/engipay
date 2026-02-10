const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Sequelize } = require('sequelize');
require('dotenv').config();

// Conditional Redis import
let createClient;
try {
  const redis = require('redis');
  createClient = redis.createClient;
} catch (error) {
  console.warn('⚠️  Redis not available, caching disabled');
  createClient = null;
}

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const portfolioRoutes = require('./routes/portfolio');
const transactionRoutes = require('./routes/transactions');
const defiRoutes = require('./routes/defi');
const swapRoutes = require('./routes/swaps');
const swapAtomiqRoutes = require('./routes/swaps-atomiq');
const atomiqAdapterRoutes = require('./routes/atomiq-adapter');
const paymentRoutes = require('./routes/payments');
const analyticsRoutes = require('./routes/analytics');
const webhookRoutes = require('./routes/webhooks');
const chipiPayRoutes = require('./routes/chipipay');
const atomiqService = require('./services/atomiqService');
const vesuRoutes = require('./routes/vesu');
const stakingRoutes = require('./routes/staking');
const helpRoutes = require('./routes/help');
const supportRoutes = require('./routes/support');
const onboardingRoutes = require('./routes/onboarding');
const kycRoutes = require('./routes/kyc');

const app = express();
const PORT = process.env.PORT || 3001;
// PostgreSQL Database connection
const sequelize = new Sequelize(
  process.env.DB_NAME || 'engipay_db',
  process.env.DB_USER || 'engipay_user',
  process.env.DB_PASSWORD || 'your_secure_password_here',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 10,
      min: parseInt(process.env.DB_POOL_MIN) || 2,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
    },
    define: {
      timestamps: true,
      underscored: true,
      paranoid: true, // Enable soft deletes
    },
  }
);

// Redis connection for caching
let redisClient = null;
if (process.env.REDIS_URL && createClient) {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL,
    });

    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
    redisClient.on('connect', () => console.log('✅ Connected to Redis'));
  } catch (error) {
    console.warn('⚠️  Redis connection failed, caching disabled');
    redisClient = null;
  }
} else {
  console.log('ℹ️  Redis not configured, caching disabled');
}

// Test database connection
const connectDatabase = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Connected to PostgreSQL database');

    // Sync database (create tables if they don't exist)
    if (process.env.NODE_ENV === 'development') {
      await sequelize.sync({ alter: true });
      console.log('✅ Database synchronized');
    }

    // Connect to Redis if configured
    if (redisClient) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Auth specific rate limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 auth requests per windowMs
  message: 'Too many authentication attempts, please try again later.'
});
app.use('/api/auth/', authLimiter);

// Atomiq specific rate limits (applied in routes)

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/defi', defiRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/swap', swapAtomiqRoutes);
app.use('/api/atomiq-adapter', atomiqAdapterRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/chipipay', chipiPayRoutes);
app.use('/api/vesu', vesuRoutes);
app.use('/api/staking', stakingRoutes);
app.use('/api/help', helpRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/users/onboarding', onboardingRoutes);
app.use('/api/users/kyc', kycRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found'
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Internal server error'
    }
  });
});

// Initialize database connection and start server
const startServer = async () => {
  await connectDatabase();

  app.listen(PORT, () => {
    console.log(`EngiPay Backend server running on port ${PORT}`);
    console.log(` Health check available at http://localhost:${PORT}/health`);
    console.log(` Database: PostgreSQL`);
    console.log(`Cache: ${redisClient ? 'Redis' : 'Disabled'}`);
  });
};

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  try {
    if (redisClient) {
      await redisClient.disconnect();
    }
    await sequelize.close();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');
  try {
    if (redisClient) {
      await redisClient.disconnect();
    }
    await sequelize.close();
  } catch (error) {
    console.error('Error during shutdown:', error);
  }
  process.exit(0);
});

// Start the server
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = { app, sequelize, redisClient };