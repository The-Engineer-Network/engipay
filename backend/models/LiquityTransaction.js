/**
 * Liquity Transaction Model
 * 
 * Records all Liquity protocol transactions
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LiquityTransaction = sequelize.define('LiquityTransaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  
  // References
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  
  troveId: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'liquity_troves',
      key: 'id',
    },
  },
  
  // Transaction details
  txHash: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      is: /^0x[a-fA-F0-9]{64}$/,
    },
  },
  
  type: {
    type: DataTypes.ENUM(
      'open_trove',
      'close_trove',
      'adjust_trove_add_collateral',
      'adjust_trove_withdraw_collateral',
      'adjust_trove_borrow',
      'adjust_trove_repay',
      'stability_deposit',
      'stability_withdraw',
      'lqty_stake',
      'lqty_unstake',
      'redeem'
    ),
    allowNull: false,
  },
  
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'failed', 'reverted'),
    defaultValue: 'pending',
    allowNull: false,
  },
  
  // Amounts
  ethAmount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'ETH amount involved',
  },
  
  lusdAmount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'LUSD amount involved',
  },
  
  lqtyAmount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'LQTY amount involved',
  },
  
  // Gas details
  gasUsed: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  
  gasPrice: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: 'Gas price in wei',
  },
  
  gasCost: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
    comment: 'Total gas cost in ETH',
  },
  
  // Block information
  blockNumber: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  
  blockTimestamp: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  // Before/after state
  beforeState: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Trove state before transaction',
  },
  
  afterState: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Trove state after transaction',
  },
  
  // Error information
  errorMessage: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  
  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
}, {
  tableName: 'liquity_transactions',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['troveId'] },
    { fields: ['txHash'], unique: true },
    { fields: ['type'] },
    { fields: ['status'] },
    { fields: ['blockNumber'] },
    { fields: ['createdAt'] },
  ],
});

module.exports = LiquityTransaction;
