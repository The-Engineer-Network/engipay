const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SwapQuote = sequelize.define('SwapQuote', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  from_token: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  to_token: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false
  },
  quote: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: () => new Date(Date.now() + 5 * 60 * 1000)
  }
}, {
  tableName: 'swap_quotes',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['expires_at']
    }
  ]
});

module.exports = SwapQuote;
