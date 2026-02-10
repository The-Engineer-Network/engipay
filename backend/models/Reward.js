const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Reward = sequelize.define('Reward', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  reward_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
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
  position_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  protocol: {
    type: DataTypes.ENUM('vesu', 'zkLend', 'aave', 'compound', 'trove', 'other'),
    allowNull: false
  },
  type: {
    type: DataTypes.ENUM('staking_reward', 'farming_reward', 'trading_fee', 'liquidity_mining', 'governance', 'airdrop', 'referral', 'bonus', 'other'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'claimable', 'claimed', 'expired', 'forfeited'),
    defaultValue: 'pending'
  },
  token_symbol: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  token_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  token_address: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false
  },
  amount_value_usd: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: true
  },
  claimed_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true
  },
  claimed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  claim_tx_hash: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  network: {
    type: DataTypes.ENUM('ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin'),
    allowNull: false
  },
  period_start: {
    type: DataTypes.DATE,
    allowNull: false
  },
  period_end: {
    type: DataTypes.DATE,
    allowNull: false
  },
  apy: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'rewards',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['user_id', 'status']
    },
    {
      fields: ['position_id']
    },
    {
      fields: ['protocol', 'type']
    },
    {
      fields: ['expires_at']
    }
  ]
});

Reward.associate = (models) => {
  Reward.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Reward;
