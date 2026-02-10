const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const DeFiPosition = sequelize.define('DeFiPosition', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  position_id: {
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
  protocol: {
    type: DataTypes.ENUM('vesu', 'zkLend', 'aave', 'compound', 'uniswap', 'sushiswap', 'curve', 'yearn', 'convex', 'lido', 'rocketpool', 'makerdao', 'other'),
    allowNull: false
  },
  protocol_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  type: {
    type: DataTypes.ENUM('supply', 'borrow', 'liquidity', 'staking', 'farming', 'vault', 'cdp', 'derivative'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'liquidating', 'liquidated', 'failed'),
    defaultValue: 'active'
  },
  assets: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  principal_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true
  },
  principal_value_usd: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: true
  },
  current_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true
  },
  current_value_usd: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: true
  },
  apy: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true
  },
  debt_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true
  },
  debt_value_usd: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: true
  },
  health_factor: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true
  },
  liquidation_threshold: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true
  },
  network: {
    type: DataTypes.ENUM('ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin'),
    allowNull: false
  },
  protocol_data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  performance: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  last_sync: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'defi_positions',
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
      fields: ['protocol', 'type']
    },
    {
      fields: ['network', 'protocol']
    },
    {
      fields: ['health_factor']
    }
  ]
});

DeFiPosition.associate = (models) => {
  DeFiPosition.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = DeFiPosition;
