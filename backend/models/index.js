const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');

const models = {};

// List of Sequelize models (PostgreSQL)
const sequelizeModels = [
  'User',
  'Transaction',
  'Portfolio',
  'PaymentRequest',
  'VesuPosition',
  'VesuTransaction',
  'VesuPool',
  'VesuLiquidation'
];

// Load only Sequelize model files
sequelizeModels.forEach(modelName => {
  const filePath = path.join(__dirname, `${modelName}.js`);
  if (fs.existsSync(filePath)) {
    const model = require(filePath);
    models[modelName] = model;
  }
});

// Set up associations for Sequelize models
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Add sequelize instance and Sequelize constructor to models
models.sequelize = sequelize;
models.Sequelize = require('sequelize').Sequelize;

// Export Mongoose models separately (they don't need associations)
models.Wallet = require('./Wallet');
models.Notification = require('./Notification');
models.DeFiPosition = require('./DeFiPosition');
models.Swap = require('./Swap');
models.SwapQuote = require('./SwapQuote');
models.Reward = require('./Reward');
models.Analytics = require('./Analytics');
models.YieldFarm = require('./YieldFarm');

module.exports = models;