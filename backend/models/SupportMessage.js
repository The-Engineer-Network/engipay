const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SupportMessage = sequelize.define('SupportMessage', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  ticket_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'support_tickets',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  is_staff: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  attachments: {
    type: DataTypes.JSONB,
    defaultValue: []
  }
}, {
  tableName: 'support_messages',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['ticket_id'] },
    { fields: ['created_at'] }
  ]
});

SupportMessage.associate = (models) => {
  SupportMessage.belongsTo(models.SupportTicket, {
    foreignKey: 'ticket_id',
    as: 'ticket'
  });
  SupportMessage.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = SupportMessage;
