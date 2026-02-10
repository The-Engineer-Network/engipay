const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Analytics = sequelize.define('Analytics', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  analytics_id: {
    type: DataTypes.STRING(255),
    allowNull: false,
    unique: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'SET NULL'
  },
  type: {
    type: DataTypes.ENUM('user_activity', 'transaction_volume', 'defi_performance', 'portfolio_performance', 'system_usage', 'error_tracking', 'conversion_funnel', 'retention_metrics', 'revenue_metrics', 'geographic_usage', 'device_analytics', 'feature_usage', 'other'),
    allowNull: false
  },
  period: {
    type: DataTypes.ENUM('minute', 'hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'),
    allowNull: false
  },
  start_date: {
    type: DataTypes.DATE,
    allowNull: false
  },
  end_date: {
    type: DataTypes.DATE,
    allowNull: false
  },
  metrics: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  aggregation_level: {
    type: DataTypes.ENUM('user', 'global', 'protocol', 'network', 'feature'),
    defaultValue: 'global'
  },
  filters: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  data_quality: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'analytics',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['type', 'period', 'start_date', 'end_date']
    },
    {
      fields: ['user_id', 'type', 'created_at']
    },
    {
      fields: ['aggregation_level', 'type']
    },
    {
      fields: ['expires_at']
    }
  ]
});

Analytics.associate = (models) => {
  Analytics.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Analytics;
