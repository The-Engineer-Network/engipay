const fs = require('fs');
const path = require('path');
const { sequelize } = require('../config/database');

const models = {};

// Load all model files
fs.readdirSync(__dirname)
  .filter(file => file !== 'index.js' && file.endsWith('.js'))
  .forEach(file => {
    const model = require(path.join(__dirname, file));
    const modelName = file.replace('.js', '');
    models[modelName] = model;
  });

// Set up associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Add sequelize instance and Sequelize constructor to models
models.sequelize = sequelize;
models.Sequelize = require('sequelize').Sequelize;

module.exports = models;