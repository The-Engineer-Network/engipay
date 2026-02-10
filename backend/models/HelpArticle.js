const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const HelpArticle = sequelize.define('HelpArticle', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  slug: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  category: {
    type: DataTypes.ENUM('basics', 'wallets', 'swaps', 'defi', 'security', 'troubleshooting'),
    allowNull: false
  },
  difficulty: {
    type: DataTypes.ENUM('Beginner', 'Intermediate', 'Advanced'),
    defaultValue: 'Beginner'
  },
  read_time: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  views: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  helpful_votes: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  published: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'help_articles',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['slug'] },
    { fields: ['category'] },
    { fields: ['published'] }
  ]
});

module.exports = HelpArticle;
