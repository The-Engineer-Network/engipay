const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // Basic user information
  username: {
    type: DataTypes.STRING(50),
    unique: true,
    allowNull: true,
  },
  email: {
    type: DataTypes.STRING(255),
    unique: true,
    allowNull: true,
    validate: {
      isEmail: true,
    },
  },
  password: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },

  // Wallet information
  wallet_address: {
    type: DataTypes.STRING(100),
    unique: true,
    allowNull: true,
    validate: {
      is: /^0x[a-fA-F0-9]{40}$/,
    },
  },
  wallet_type: {
    type: DataTypes.ENUM('metamask', 'argent', 'braavos', 'xverse', 'walletconnect'),
    allowNull: true,
  },

  // Profile information
  first_name: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  last_name: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },
  avatar_url: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      len: [0, 500],
    },
  },

  // KYC/Verification
  kyc_status: {
    type: DataTypes.ENUM('pending', 'in_review', 'approved', 'rejected', 'not_required'),
    defaultValue: 'pending',
  },
  kyc_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },

  // Security settings
  two_factor_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  two_factor_secret: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  // User preferences (stored as JSON)
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      notifications: {
        email: true,
        push: true,
        sms: false,
        marketing: false,
      },
      currency: 'USD',
      language: 'en',
      theme: 'auto',
      timezone: 'UTC',
    },
  },

  // Account status
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  is_email_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  email_verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  last_login: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  login_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },

  // Risk assessment
  risk_score: {
    type: DataTypes.INTEGER,
    defaultValue: 50,
    validate: {
      min: 0,
      max: 100,
    },
  },
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'very_high'),
    defaultValue: 'medium',
  },

  // Referral system
  referral_code: {
    type: DataTypes.STRING(50),
    unique: true,
    allowNull: true,
  },
  referral_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },

  // Social links (stored as JSON)
  social_links: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },
}, {
  // Model options
  indexes: [
    {
      fields: ['wallet_address'],
      unique: true,
    },
    {
      fields: ['email'],
      unique: true,
    },
    {
      fields: ['username'],
      unique: true,
    },
    {
      fields: ['kyc_status'],
    },
    {
      fields: ['created_at'],
    },
    {
      fields: ['last_login'],
    },
  ],
});

// Virtual for full name
User.prototype.getFullName = function() {
  if (this.first_name && this.last_name) {
    return `${this.first_name} ${this.last_name}`;
  }
  return this.username || this.email || 'Anonymous User';
};

// Method to check if user is verified
User.prototype.isVerified = function() {
  return this.kyc_status === 'approved' && this.is_email_verified;
};

// Method to get user initials
User.prototype.getInitials = function() {
  if (this.first_name && this.last_name) {
    return `${this.first_name[0]}${this.last_name[0]}`.toUpperCase();
  }
  if (this.username) {
    return this.username.substring(0, 2).toUpperCase();
  }
  return 'U';
};

// Static method to find user by wallet or email
User.findByWalletOrEmail = async function(identifier) {
  return await this.findOne({
    where: {
      [sequelize.Op.or]: [
        { wallet_address: identifier.toLowerCase() },
        { email: identifier.toLowerCase() }
      ]
    }
  });
};

// Associations (to be defined after all models are loaded)
User.associate = (models) => {
  // Self-referencing association for referrals
  User.belongsTo(models.User, {
    foreignKey: 'referred_by',
    as: 'referrer'
  });
  User.hasMany(models.User, {
    foreignKey: 'referred_by',
    as: 'referrals'
  });

  // Other associations
  User.hasMany(models.Transaction, {
    foreignKey: 'user_id',
    as: 'transactions'
  });
  User.hasMany(models.Portfolio, {
    foreignKey: 'user_id',
    as: 'portfolios'
  });
  User.hasMany(models.Wallet, {
    foreignKey: 'user_id',
    as: 'wallets'
  });
  User.hasMany(models.Notification, {
    foreignKey: 'user_id',
    as: 'notifications'
  });
  User.hasMany(models.DeFiPosition, {
    foreignKey: 'user_id',
    as: 'defi_positions'
  });
  User.hasMany(models.Reward, {
    foreignKey: 'user_id',
    as: 'rewards'
  });
};

module.exports = User;