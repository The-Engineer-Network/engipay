const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VesuLiquidation = sequelize.define('VesuLiquidation', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // Foreign key to position
  position_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'VesuPosition',
      key: 'id',
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },

  // Liquidator information
  liquidator_address: {
    type: DataTypes.STRING(66),
    allowNull: false,
    comment: 'Starknet address of the liquidator',
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },

  // Transaction details
  transaction_hash: {
    type: DataTypes.STRING(66),
    allowNull: false,
    unique: true,
    comment: 'Starknet transaction hash of liquidation',
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },

  // Liquidation amounts
  collateral_seized: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    comment: 'Amount of collateral seized from position',
    validate: {
      min: 0,
    },
  },
  debt_repaid: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    comment: 'Amount of debt repaid by liquidator',
    validate: {
      min: 0,
    },
  },
  liquidation_bonus: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    comment: 'Bonus amount received by liquidator',
    validate: {
      min: 0,
    },
  },

  // Timestamp
  timestamp: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'When the liquidation occurred',
  },
}, {
  // Model options
  tableName: 'vesu_liquidations',
  indexes: [
    {
      fields: ['position_id'],
      name: 'idx_vesu_liquidations_position_id',
    },
    {
      fields: ['liquidator_address'],
      name: 'idx_vesu_liquidations_liquidator',
    },
    {
      fields: ['transaction_hash'],
      unique: true,
      name: 'idx_vesu_liquidations_hash',
    },
    {
      fields: ['timestamp'],
      name: 'idx_vesu_liquidations_timestamp',
    },
    {
      fields: ['created_at'],
      name: 'idx_vesu_liquidations_created_at',
    },
  ],
});

// Instance methods
VesuLiquidation.prototype.getLiquidationProfit = function() {
  return parseFloat(this.liquidation_bonus);
};

VesuLiquidation.prototype.getTotalCollateralValue = function() {
  return parseFloat(this.collateral_seized);
};

VesuLiquidation.prototype.getDebtCovered = function() {
  return parseFloat(this.debt_repaid);
};

VesuLiquidation.prototype.getLiquidationRatio = function() {
  const debtRepaid = parseFloat(this.debt_repaid);
  if (debtRepaid === 0) return 0;
  const collateralSeized = parseFloat(this.collateral_seized);
  return collateralSeized / debtRepaid;
};

// Static methods
VesuLiquidation.findByHash = async function(transactionHash) {
  return await this.findOne({
    where: { transaction_hash: transactionHash },
  });
};

VesuLiquidation.findByPosition = async function(positionId) {
  return await this.findAll({
    where: { position_id: positionId },
    order: [['timestamp', 'DESC']],
  });
};

VesuLiquidation.findByLiquidator = async function(liquidatorAddress, limit = 50) {
  return await this.findAll({
    where: { liquidator_address: liquidatorAddress },
    order: [['timestamp', 'DESC']],
    limit,
  });
};

VesuLiquidation.getRecentLiquidations = async function(limit = 100) {
  return await this.findAll({
    order: [['timestamp', 'DESC']],
    limit,
  });
};

VesuLiquidation.getLiquidationStats = async function(startDate = null, endDate = null) {
  const where = {};
  
  if (startDate) {
    where.timestamp = { [sequelize.Sequelize.Op.gte]: startDate };
  }
  if (endDate) {
    where.timestamp = where.timestamp || {};
    where.timestamp[sequelize.Sequelize.Op.lte] = endDate;
  }

  const liquidations = await this.findAll({ where });
  
  let totalCollateralSeized = 0;
  let totalDebtRepaid = 0;
  let totalBonuses = 0;
  const liquidatorSet = new Set();

  liquidations.forEach(liq => {
    totalCollateralSeized += parseFloat(liq.collateral_seized);
    totalDebtRepaid += parseFloat(liq.debt_repaid);
    totalBonuses += parseFloat(liq.liquidation_bonus);
    liquidatorSet.add(liq.liquidator_address);
  });

  return {
    totalLiquidations: liquidations.length,
    totalCollateralSeized,
    totalDebtRepaid,
    totalBonuses,
    uniqueLiquidators: liquidatorSet.size,
    avgCollateralPerLiquidation: liquidations.length > 0 ? totalCollateralSeized / liquidations.length : 0,
    avgDebtPerLiquidation: liquidations.length > 0 ? totalDebtRepaid / liquidations.length : 0,
    avgBonusPerLiquidation: liquidations.length > 0 ? totalBonuses / liquidations.length : 0,
  };
};

VesuLiquidation.getLiquidatorLeaderboard = async function(startDate = null, endDate = null, limit = 10) {
  const where = {};
  
  if (startDate) {
    where.timestamp = { [sequelize.Sequelize.Op.gte]: startDate };
  }
  if (endDate) {
    where.timestamp = where.timestamp || {};
    where.timestamp[sequelize.Sequelize.Op.lte] = endDate;
  }

  const liquidations = await this.findAll({ where });
  
  const liquidatorStats = {};
  
  liquidations.forEach(liq => {
    const addr = liq.liquidator_address;
    if (!liquidatorStats[addr]) {
      liquidatorStats[addr] = {
        address: addr,
        count: 0,
        totalBonus: 0,
        totalDebtRepaid: 0,
        totalCollateralSeized: 0,
      };
    }
    liquidatorStats[addr].count++;
    liquidatorStats[addr].totalBonus += parseFloat(liq.liquidation_bonus);
    liquidatorStats[addr].totalDebtRepaid += parseFloat(liq.debt_repaid);
    liquidatorStats[addr].totalCollateralSeized += parseFloat(liq.collateral_seized);
  });

  return Object.values(liquidatorStats)
    .sort((a, b) => b.totalBonus - a.totalBonus)
    .slice(0, limit);
};

// Associations
VesuLiquidation.associate = (models) => {
  VesuLiquidation.belongsTo(models.VesuPosition, {
    foreignKey: 'position_id',
    as: 'position',
  });
};

module.exports = VesuLiquidation;
