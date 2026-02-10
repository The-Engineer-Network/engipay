const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const KYCVerification = sequelize.define('KYCVerification', {
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
  status: {
    type: DataTypes.ENUM('not_started', 'pending', 'under_review', 'verified', 'rejected'),
    defaultValue: 'not_started'
  },
  verification_level: {
    type: DataTypes.ENUM('tier_1', 'tier_2', 'tier_3'),
    allowNull: true
  },
  document_type: {
    type: DataTypes.ENUM('passport', 'drivers_license', 'national_id'),
    allowNull: true
  },
  documents: {
    type: DataTypes.JSONB,
    defaultValue: []
  },
  personal_info: {
    type: DataTypes.JSONB,
    defaultValue: {}
  },
  submitted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejected_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejection_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  limits: {
    type: DataTypes.JSONB,
    defaultValue: {
      daily_transaction: 1000,
      monthly_transaction: 10000
    }
  }
}, {
  tableName: 'kyc_verifications',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['user_id'] },
    { fields: ['status'] }
  ]
});

KYCVerification.associate = (models) => {
  KYCVerification.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = KYCVerification;
