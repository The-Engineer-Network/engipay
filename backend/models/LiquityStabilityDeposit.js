/**
 * Liquity Stability Pool Deposit Model
 * 
 * Tracks user deposits in the Liquity Stability Pool
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LiquityStabilityDeposit = sequelize.define('LiquityStabilityDeposit', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  
  depositorAddress: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      is: /^0x[a-fA-F0-9]{40}$/,
    },
  },
  
  // Deposit amount
  depositAmount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'Current LUSD deposit in Stability Pool',
  },
  
  initialDeposit: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    comment: 'Initial LUSD deposit amount',
  },
  
  // Rewards
  ethGainAccumulated: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'ETH gained from liquidations',
  },
  
  lqtyRewardAccumulated: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'LQTY rewards accumulated',
  },
  
  ethGainClaimed: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'ETH gains claimed',
  },
  
  lqtyRewardClaimed: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'LQTY rewards claimed',
  },
  
  // Status
  status: {
    type: DataTypes.ENUM('active', 'withdrawn', 'partial'),
    defaultValue: 'active',
  },
  
  // Timestamps
  depositedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  
  lastUpdatedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  withdrawnAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
}, {
  tableName: 'liquity_stability_deposits',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['depositorAddress'] },
    { fields: ['status'] },
  ],
});

module.exports = LiquityStabilityDeposit;
