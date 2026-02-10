const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Wallet = sequelize.define('Wallet', {
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
    }
  },
  wallet_address: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  wallet_type: {
    type: DataTypes.ENUM('metamask', 'argent', 'braavos', 'xverse', 'other'),
    allowNull: false
  },
  chain: {
    type: DataTypes.ENUM('ethereum', 'starknet', 'bitcoin'),
    allowNull: false
  },
  is_primary: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  label: {
    type: DataTypes.STRING,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {}
  }
}, {
  tableName: 'wallets',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      fields: ['user_id']
    },
    {
      fields: ['wallet_address'],
      unique: true
    }
  ]
});

Wallet.associate = (models) => {
  Wallet.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Wallet;
