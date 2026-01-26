const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VesuPool = sequelize.define('VesuPool', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  pool_address: {
    type: DataTypes.STRING(66),
    allowNull: false,
    unique: true,
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },
  collateral_asset: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  debt_asset: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  max_ltv: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false,
    validate: {
      min: 0,
      max: 1,
    },
  },
  liquidation_threshold: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false,
    validate: {
      min: 0,
      max: 1,
    },
  },
  liquidation_bonus: {
    type: DataTypes.DECIMAL(5, 4),
    allowNull: false,
    validate: {
      min: 0,
      max: 1,
    },
  },
  total_supply: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    validate: {
      min: 0,
    },
  },
  total_borrow: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: '0',
    validate: {
      min: 0,
    },
  },
  supply_apy: {
    type: DataTypes.DECIMAL(8, 6),
    allowNull: true,
    validate: {
      min: 0,
    },
  },
  borrow_apy: {
    type: DataTypes.DECIMAL(8, 6),
    allowNull: true,
    validate: {
      min: 0,
    },
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  last_synced: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
}, {
  tableName: 'vesu_pools',
  indexes: [
    { fields: ['pool_address'], unique: true, name: 'idx_vesu_pools_address' },
    { fields: ['collateral_asset', 'debt_asset'], name: 'idx_vesu_pools_asset_pair' },
    { fields: ['is_active'], name: 'idx_vesu_pools_is_active' },
    { fields: ['last_synced'], name: 'idx_vesu_pools_last_synced' },
  ],
});

VesuPool.prototype.getUtilizationRate = function() {
  const supply = parseFloat(this.total_supply);
  if (supply === 0) return 0;
  return parseFloat(this.total_borrow) / supply;
};

VesuPool.prototype.getAvailableLiquidity = function() {
  return Math.max(0, parseFloat(this.total_supply) - parseFloat(this.total_borrow));
};

VesuPool.prototype.isHealthy = function() {
  return this.getUtilizationRate() < 0.95;
};

VesuPool.prototype.canBorrow = function(amount) {
  return parseFloat(amount) <= this.getAvailableLiquidity();
};

VesuPool.prototype.needsSync = function(maxAgeMinutes = 5) {
  const ageMinutes = (new Date() - new Date(this.last_synced)) / (1000 * 60);
  return ageMinutes > maxAgeMinutes;
};

VesuPool.prototype.getAssetPair = function() {
  return `${this.collateral_asset}-${this.debt_asset}`;
};

VesuPool.findByAddress = async function(poolAddress) {
  return await this.findOne({ where: { pool_address: poolAddress } });
};

VesuPool.findActivePools = async function() {
  return await this.findAll({ where: { is_active: true }, order: [['total_supply', 'DESC']] });
};

VesuPool.findByAssetPair = async function(collateralAsset, debtAsset) {
  return await this.findOne({ where: { collateral_asset: collateralAsset, debt_asset: debtAsset, is_active: true } });
};

VesuPool.findPoolsNeedingSync = async function(maxAgeMinutes = 5) {
  const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000);
  return await this.findAll({ where: { is_active: true, last_synced: { [sequelize.Sequelize.Op.lt]: cutoffTime } } });
};

VesuPool.getPoolStats = async function() {
  const pools = await this.findAll({ where: { is_active: true } });
  let totalSupply = 0, totalBorrow = 0, avgSupplyAPY = 0, avgBorrowAPY = 0;
  pools.forEach(pool => {
    totalSupply += parseFloat(pool.total_supply);
    totalBorrow += parseFloat(pool.total_borrow);
    if (pool.supply_apy) avgSupplyAPY += parseFloat(pool.supply_apy);
    if (pool.borrow_apy) avgBorrowAPY += parseFloat(pool.borrow_apy);
  });
  return {
    totalPools: pools.length,
    totalSupply,
    totalBorrow,
    avgSupplyAPY: pools.length > 0 ? avgSupplyAPY / pools.length : 0,
    avgBorrowAPY: pools.length > 0 ? avgBorrowAPY / pools.length : 0,
    utilizationRate: totalSupply > 0 ? totalBorrow / totalSupply : 0,
  };
};

VesuPool.associate = (models) => {
  VesuPool.hasMany(models.VesuPosition, { foreignKey: 'pool_address', sourceKey: 'pool_address', as: 'positions' });
};

module.exports = VesuPool;
