const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const UserOnboarding = sequelize.define('UserOnboarding', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    unique: true,
    references: {
      model: 'users',
      key: 'id'
    },
    onDelete: 'CASCADE'
  },
  is_completed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  current_step: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  steps_completed: {
    type: DataTypes.ARRAY(DataTypes.STRING),
    defaultValue: []
  },
  completion_percentage: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  started_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'user_onboarding',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['is_completed'] }
  ]
});

UserOnboarding.associate = (models) => {
  UserOnboarding.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = UserOnboarding;
