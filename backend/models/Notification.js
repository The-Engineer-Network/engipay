const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
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
  type: {
    type: DataTypes.ENUM('transaction', 'swap', 'defi', 'price_alert', 'system', 'security'),
    allowNull: false
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  message: {
    type: DataTypes.STRING(1000),
    allowNull: false
  },
  data: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  read: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  read_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  priority: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'urgent'),
    defaultValue: 'medium'
  },
  action_url: {
    type: DataTypes.STRING(500),
    allowNull: true
  }
}, {
  tableName: 'notifications',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['user_id', 'read']
    },
    {
      fields: ['user_id', 'created_at']
    },
    {
      fields: ['type', 'created_at']
    }
  ]
});

Notification.associate = (models) => {
  Notification.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Notification;
