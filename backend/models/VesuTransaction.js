const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VesuTransaction = sequelize.define('VesuTransaction', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  position_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: { model: 'VesuPosition', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'SET NULL',
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: 'User', key: 'id' },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
  },
  transaction_hash: {
    type: DataTypes.STRING(66),
    allowNull: false,
    unique: true,
    validate: {
      is: /^0x[a-fA-F0-9]{1,64}$/,
    },
  },
  type: {
    type: DataTypes.ENUM('supply', 'borrow', 'repay', 'withdraw', 'liquidation'),
    allowNull: false,
  },
  asset: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    validate: { min: 0 },
  },
  status: {
    type: DataTypes.ENUM('pending', 'confirmed', 'failed'),
    allowNull: false,
    defaultValue: 'pending',
  },
  block_number: {
    type: DataTypes.BIGINT,
    allowNull: true,
  },
  timestamp: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  gas_used: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'vesu_transactions',
  indexes: [
    { fields: ['user_id'], name: 'idx_vesu_transactions_user_id' },
    { fields: ['position_id'], name: 'idx_vesu_transactions_position_id' },
    { fields: ['transaction_hash'], unique: true, name: 'idx_vesu_transactions_hash' },
    { fields: ['type'], name: 'idx_vesu_transactions_type' },
    { fields: ['status'], name: 'idx_vesu_transactions_status' },
    { fields: ['user_id', 'type'], name: 'idx_vesu_transactions_user_type' },
    { fields: ['created_at'], name: 'idx_vesu_transactions_created_at' },
    { fields: ['timestamp'], name: 'idx_vesu_transactions_timestamp' },
  ],
});

VesuTransaction.prototype.isPending = function() { return this.status === 'pending'; };
VesuTransaction.prototype.isConfirmed = function() { return this.status === 'confirmed'; };
VesuTransaction.prototype.isFailed = function() { return this.status === 'failed'; };
VesuTransaction.prototype.isSupply = function() { return this.type === 'supply'; };
VesuTransaction.prototype.isBorrow = function() { return this.type === 'borrow'; };
VesuTransaction.prototype.isRepay = function() { return this.type === 'repay'; };
VesuTransaction.prototype.isWithdraw = function() { return this.type === 'withdraw'; };
VesuTransaction.prototype.isLiquidation = function() { return this.type === 'liquidation'; };

VesuTransaction.findByHash = async function(transactionHash) {
  return await this.findOne({ where: { transaction_hash: transactionHash } });
};

VesuTransaction.findPendingTransactions = async function() {
  return await this.findAll({ where: { status: 'pending' }, order: [['created_at', 'ASC']] });
};

VesuTransaction.findUserTransactions = async function(userId, type = null, limit = 50) {
  const where = { user_id: userId };
  if (type) where.type = type;
  return await this.findAll({ where, order: [['created_at', 'DESC']], limit });
};

VesuTransaction.findPositionTransactions = async function(positionId) {
  return await this.findAll({ where: { position_id: positionId }, order: [['created_at', 'DESC']] });
};

VesuTransaction.getTransactionStats = async function(userId, startDate = null, endDate = null) {
  const where = { user_id: userId, status: 'confirmed' };
  if (startDate) where.timestamp = { [sequelize.Sequelize.Op.gte]: startDate };
  if (endDate) {
    where.timestamp = where.timestamp || {};
    where.timestamp[sequelize.Sequelize.Op.lte] = endDate;
  }
  const transactions = await this.findAll({ where });
  const stats = { total: transactions.length, byType: {}, totalVolume: {} };
  transactions.forEach(tx => {
    stats.byType[tx.type] = (stats.byType[tx.type] || 0) + 1;
    stats.totalVolume[tx.asset] = (stats.totalVolume[tx.asset] || 0) + parseFloat(tx.amount);
  });
  return stats;
};

VesuTransaction.associate = (models) => {
  VesuTransaction.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  VesuTransaction.belongsTo(models.VesuPosition, { foreignKey: 'position_id', as: 'position' });
};

module.exports = VesuTransaction;
