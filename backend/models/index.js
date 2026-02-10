const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');

const models = {};

// List of all Sequelize models (PostgreSQL)
const sequelizeModels = [
  'User',
  'Transaction',
  'Portfolio',
  'PaymentRequest',
  'VesuPosition',
  'VesuTransaction',
  'VesuPool',
  'VesuLiquidation',
  'StakingPosition',
  'StakingTransaction',
  'Wallet',
  'Notification',
  'DeFiPosition',
  'Swap',
  'SwapQuote',
  'Reward',
  'Analytics',
  'YieldFarm',
  'SupportTicket',
  'SupportMessage',
  'UserOnboarding',
  'KYCVerification',
  'HelpArticle',
  'HelpVideo'
];

// Load all Sequelize model files
sequelizeModels.forEach(modelName => {
  const filePath = path.join(__dirname, `${modelName}.js`);
  if (fs.existsSync(filePath)) {
    const model = require(filePath);
    models[modelName] = model;
  }
});

// Set up associations for all models
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Add sequelize instance and Sequelize constructor to models
models.sequelize = sequelize;
models.Sequelize = require('sequelize').Sequelize;

module.exports = models;