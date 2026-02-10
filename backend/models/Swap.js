const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Swap = sequelize.define('Swap', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  from_token: {
    type: DataTypes.ENUM('BTC', 'ETH', 'STRK', 'USDT', 'USDC'),
    allowNull: false
  },
  to_token: {
    type: DataTypes.ENUM('BTC', 'ETH', 'STRK', 'USDT', 'USDC'),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false
  },
  expected_output: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false
  },
  actual_output: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true
  },
  fee: {
    type: DataTypes.DECIMAL(36, 18),
    defaultValue: 0
  },
  slippage: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.5
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'refunded'),
    defaultValue: 'pending'
  },
  tx_hash: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  blockchain_tx_hash: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  atomiq_swap_id: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  wallet_address: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'swaps',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['tx_hash']
    },
    {
      fields: ['status']
    },
    {
      fields: ['user_id', 'created_at']
    }
  ]
});

Swap.associate = (models) => {
  Swap.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Swap;
