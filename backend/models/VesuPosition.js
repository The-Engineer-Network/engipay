const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VesuPosition = sequelize.define('VesuPosition', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // Foreign key to User
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'User',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },

  // Pool information
  pool_address: {
    type: DataTypes.STRING(66),
    allowNull: false,
    comment: 'Starknet contract address of the Vesu pool',
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },

  // Asset information
  collateral_asset: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Symbol of collateral asset (e.g., ETH, STRK)',
  },
  debt_asset: {
    type: DataTypes.STRING(20),
    allowNull: false,
    comment: 'Symbol of debt asset (e.g., USDC)',
  },

  // Position amounts (using DECIMAL for precise financial calculations)
  collateral_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Amount of collateral supplied',
    validate: {
      min: 0,
    },
  },
  debt_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Amount of debt borrowed',
    validate: {
      min: 0,
    },
  },

  // vToken tracking (ERC-4626)
  vtoken_balance: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    comment: 'Balance of vTokens representing supplied assets',
    validate: {
      min: 0,
    },
  },

  // Health metrics
  health_factor: {
    type: DataTypes.DECIMAL(18, 6),
    allowNull: true,
    comment: 'Position health factor (collateral / debt ratio)',
    validate: {
      min: 0,
    },
  },

  // Position status
  status: {
    type: DataTypes.ENUM('active', 'liquidated', 'closed'),
    allowNull: false,
    defaultValue: 'active',
    comment: 'Current status of the position',
  },

  // Timestamps
  last_updated: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'Last time position data was updated',
  },
}, {
  // Model options
  tableName: 'vesu_positions',
  indexes: [
    {
      fields: ['user_id'],
      name: 'idx_vesu_positions_user_id',
    },
    {
      fields: ['pool_address'],
      name: 'idx_vesu_positions_pool_address',
    },
    {
      fields: ['status'],
      name: 'idx_vesu_positions_status',
    },
    {
      fields: ['health_factor'],
      name: 'idx_vesu_positions_health_factor',
    },
    {
      fields: ['user_id', 'pool_address'],
      name: 'idx_vesu_positions_user_pool',
    },
    {
      fields: ['status', 'health_factor'],
      name: 'idx_vesu_positions_status_health',
    },
    {
      fields: ['last_updated'],
      name: 'idx_vesu_positions_last_updated',
    },
  ],
});

// Instance methods
VesuPosition.prototype.isHealthy = function() {
  if (!this.health_factor) return true; // No debt means healthy
  return parseFloat(this.health_factor) >= 1.0;
};

VesuPosition.prototype.isAtRisk = function() {
  if (!this.health_factor) return false;
  const hf = parseFloat(this.health_factor);
  return hf < 1.2 && hf >= 1.0;
};

VesuPosition.prototype.isCritical = function() {
  if (!this.health_factor) return false;
  const hf = parseFloat(this.health_factor);
  return hf < 1.05 && hf >= 1.0;
};

VesuPosition.prototype.isLiquidatable = function() {
  if (!this.health_factor) return false;
  return parseFloat(this.health_factor) < 1.0;
};

VesuPosition.prototype.hasDebt = function() {
  return parseFloat(this.debt_amount) > 0;
};

VesuPosition.prototype.hasCollateral = function() {
  return parseFloat(this.collateral_amount) > 0;
};

// Static methods
VesuPosition.findActivePositions = async function() {
  return await this.findAll({
    where: { status: 'active' },
    order: [['health_factor', 'ASC NULLS LAST']],
  });
};

VesuPosition.findLiquidatablePositions = async function() {
  return await this.findAll({
    where: {
      status: 'active',
      health_factor: {
        [sequelize.Sequelize.Op.lt]: 1.0,
      },
    },
    order: [['health_factor', 'ASC']],
  });
};

VesuPosition.findAtRiskPositions = async function() {
  return await this.findAll({
    where: {
      status: 'active',
      health_factor: {
        [sequelize.Sequelize.Op.and]: [
          { [sequelize.Sequelize.Op.lt]: 1.2 },
          { [sequelize.Sequelize.Op.gte]: 1.0 },
        ],
      },
    },
    order: [['health_factor', 'ASC']],
  });
};

VesuPosition.findUserPositions = async function(userId, status = null) {
  const where = { user_id: userId };
  if (status) {
    where.status = status;
  }
  return await this.findAll({
    where,
    order: [['created_at', 'DESC']],
  });
};

// Associations
VesuPosition.associate = (models) => {
  VesuPosition.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user',
  });
  VesuPosition.hasMany(models.VesuTransaction, {
    foreignKey: 'position_id',
    as: 'transactions',
  });
  VesuPosition.hasMany(models.VesuLiquidation, {
    foreignKey: 'position_id',
    as: 'liquidations',
  });
};

module.exports = VesuPosition;
