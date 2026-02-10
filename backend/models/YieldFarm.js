const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const YieldFarm = sequelize.define('YieldFarm', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  farm_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  protocol: {
    type: DataTypes.ENUM('uniswap', 'sushiswap', 'pancakeswap', 'curve', 'balancer', 'yearn', 'convex', 'compound', 'aave', 'vesu', 'zkLend', 'other'),
    allowNull: false
  },
  protocol_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  type: {
    type: DataTypes.ENUM('liquidity_pool', 'single_stake', 'dual_farm', 'vault', 'auto_compound', 'leveraged', 'other'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'deprecated', 'paused'),
    defaultValue: 'active'
  },
  network: {
    type: DataTypes.ENUM('ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bsc', 'avalanche'),
    allowNull: false
  },
  farm_contract_address: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  staking_token: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  reward_tokens: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  tvl: {
    type: DataTypes.DECIMAL(20, 2),
    defaultValue: 0
  },
  total_staked: {
    type: DataTypes.DECIMAL(36, 18),
    defaultValue: 0
  },
  apy: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true
  },
  base_apy: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true
  },
  reward_apy: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true
  },
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'very_high'),
    defaultValue: 'medium'
  },
  min_stake_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true
  },
  lock_period_days: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  total_stakers: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  tags: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: []
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  ends_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_sync: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'yield_farms',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['protocol', 'network']
    },
    {
      fields: ['type', 'status']
    },
    {
      fields: ['tvl']
    },
    {
      fields: ['apy']
    },
    {
      fields: ['farm_contract_address']
    }
  ]
});

module.exports = YieldFarm;
