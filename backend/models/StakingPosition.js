/**
 * Staking Position Model
 * 
 * Tracks user staking positions in Trove staking protocol
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const StakingPosition = sequelize.define('StakingPosition', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // User reference
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },

  // Staking contract information
  staking_contract_address: {
    type: DataTypes.STRING(66),
    allowNull: false,
    comment: 'Starknet contract address of the staking pool',
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },

  // Token information
  staking_token: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Symbol of staked token (e.g., STRK, ETH)',
  },
  
  reward_token: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Symbol of reward token',
  },

  // Staking amounts
  staked_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Amount of tokens currently staked',
    validate: {
      min: 0,
    },
  },

  // Rewards tracking
  unclaimed_rewards: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Accumulated unclaimed rewards',
    validate: {
      min: 0,
    },
  },

  total_rewards_claimed: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Total rewards claimed historically',
    validate: {
      min: 0,
    },
  },

  total_rewards_earned: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Total rewards earned (claimed + unclaimed)',
    validate: {
      min: 0,
    },
  },

  // APY tracking
  current_apy: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    comment: 'Current APY percentage',
  },

  // Position status
  status: {
    type: DataTypes.ENUM('active', 'withdrawn', 'partial'),
    defaultValue: 'active',
    comment: 'Status of staking position',
  },

  // Timestamps
  staked_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'When position was first created',
  },

  last_reward_claim_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Last time rewards were claimed',
  },

  last_updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Last time position was updated',
  },

  withdrawn_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When position was fully withdrawn',
  },

  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Additional metadata and history',
  },
}, {
  tableName: 'staking_positions',
  timestamps: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['staking_contract_address'] },
    { fields: ['status'] },
    { fields: ['staking_token'] },
    { fields: ['user_id', 'staking_contract_address'] },
    { fields: ['last_updated_at'] },
  ],
});

// Instance methods
StakingPosition.prototype.hasStake = function() {
  return parseFloat(this.staked_amount) > 0;
};

StakingPosition.prototype.hasUnclaimedRewards = function() {
  return parseFloat(this.unclaimed_rewards) > 0;
};

StakingPosition.prototype.getTotalValue = function(stakingTokenPrice, rewardTokenPrice) {
  const stakedValue = parseFloat(this.staked_amount) * stakingTokenPrice;
  const rewardValue = parseFloat(this.unclaimed_rewards) * rewardTokenPrice;
  return stakedValue + rewardValue;
};

StakingPosition.prototype.getStakingDuration = function() {
  const now = new Date();
  const stakedAt = new Date(this.staked_at);
  return Math.floor((now - stakedAt) / (1000 * 60 * 60 * 24)); // Days
};

StakingPosition.prototype.estimateDailyRewards = function() {
  if (!this.current_apy || parseFloat(this.staked_amount) === 0) {
    return 0;
  }
  
  const apy = parseFloat(this.current_apy) / 100;
  const stakedAmount = parseFloat(this.staked_amount);
  return (stakedAmount * apy) / 365;
};

// Static methods
StakingPosition.findActivePositions = async function() {
  return await this.findAll({
    where: { status: 'active' },
    order: [['staked_amount', 'DESC']],
  });
};

StakingPosition.findUserPositions = async function(userId, status = null) {
  const where = { user_id: userId };
  if (status) {
    where.status = status;
  }
  return await this.findAll({
    where,
    order: [['created_at', 'DESC']],
  });
};

StakingPosition.getTotalStakedByUser = async function(userId) {
  const positions = await this.findAll({
    where: {
      user_id: userId,
      status: 'active',
    },
  });

  return positions.reduce((total, pos) => {
    return total + parseFloat(pos.staked_amount);
  }, 0);
};

StakingPosition.getTotalRewardsByUser = async function(userId) {
  const positions = await this.findAll({
    where: { user_id: userId },
  });

  return positions.reduce((total, pos) => {
    return total + parseFloat(pos.total_rewards_earned);
  }, 0);
};

// Associations
StakingPosition.associate = (models) => {
  StakingPosition.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  StakingPosition.hasMany(models.StakingTransaction, {
    foreignKey: 'position_id',
    as: 'transactions',
  });
};

module.exports = StakingPosition;
