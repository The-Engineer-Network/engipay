/**
 * Staking Transaction Model
 * 
 * Records all staking-related transactions
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StakingTransaction = sequelize.define('StakingTransaction', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // References
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
  },

  position_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'staking_positions',
      key: 'id',
    },
  },

  // Transaction details
  transaction_hash: {
    type: DataTypes.STRING(66),
    allowNull: false,
    unique: true,
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },

  type: {
    type: DataTypes.ENUM(
      'stake',
      'withdraw',
      'claim_rewards',
      'compound'
    ),
    allowNull: false,
  },

  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'failed', 'reverted'),
    defaultValue: 'pending',
    allowNull: false,
  },

  // Amounts
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'Amount of tokens involved',
  },

  reward_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'Amount of rewards claimed',
  },

  // Token information
  token: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Token symbol',
  },

  // Gas details
  gas_used: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },

  gas_price: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Gas price in wei',
  },

  gas_cost: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'Total gas cost in native token',
  },

  // Block information
  block_number: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },

  block_timestamp: {
    type: DataTypes.DATE,
    allowNull: true,
  },

  // Error information
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
}, {
  tableName: 'staking_transactions',
  timestamps: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['position_id'] },
    { fields: ['transaction_hash'], unique: true },
    { fields: ['type'] },
    { fields: ['status'] },
    { fields: ['block_number'] },
    { fields: ['created_at'] },
  ],
});

// Associations
StakingTransaction.associate = (models) => {
  StakingTransaction.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  StakingTransaction.belongsTo(models.StakingPosition, {
    foreignKey: 'position_id',
    as: 'position',
  });
};

module.exports = StakingTransaction;
