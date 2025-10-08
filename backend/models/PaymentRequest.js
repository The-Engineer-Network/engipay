const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PaymentRequest = sequelize.define('PaymentRequest', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // Request identification
  request_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },

  // Request creator
  from_user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },

  // Request recipient (optional)
  to_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },

  // Request details
  title: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  // Amount and currency
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
  },
  currency: {
    type: DataTypes.ENUM('USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'STRK', 'USDT', 'USDC'),
    defaultValue: 'USD',
  },

  // Crypto equivalent (optional)
  amount_crypto: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },
  crypto_currency: {
    type: DataTypes.ENUM('BTC', 'ETH', 'STRK', 'USDT', 'USDC'),
    allowNull: true,
  },

  // Payment methods accepted
  accepted_currencies: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },

  // Request status
  status: {
    type: DataTypes.ENUM('active', 'paid', 'expired', 'cancelled', 'refunded'),
    defaultValue: 'active',
  },

  // Expiration
  expires_at: {
    type: DataTypes.DATE,
    allowNull: false,
  },

  // Payment information (when paid)
  paid_transaction_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Transactions',
      key: 'id'
    }
  },
  paid_by_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  paid_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },
  paid_currency: {
    type: DataTypes.ENUM('USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH', 'STRK', 'USDT', 'USDC'),
    allowNull: true,
  },

  // Public link information
  public_link: {
    type: DataTypes.STRING(255),
    allowNull: true,
    unique: true,
  },
  is_public: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },

  // Contact information
  recipient_email: {
    type: DataTypes.STRING(255),
    allowNull: true,
    validate: {
      isEmail: true,
    },
  },
  recipient_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },

  // Additional settings
  allow_partial_payment: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  minimum_partial_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },

  // Notifications
  email_notifications: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
  push_notifications: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },

  // Metadata
  tags: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },
  category: {
    type: DataTypes.ENUM('invoice', 'donation', 'service', 'product', 'subscription', 'refund', 'other'),
    defaultValue: 'other',
  },
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },

  // Invoice specific fields
  invoice_number: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  tax_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },
  discount_amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },

  // Analytics
  views_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },
  shares_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },

  // Timestamps
  cancelled_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  // Model options
  indexes: [
    {
      fields: ['request_id'],
      unique: true,
    },
    {
      fields: ['from_user_id', 'status', 'created_at'],
    },
    {
      fields: ['to_user_id', 'status'],
    },
    {
      fields: ['public_link'],
      unique: true,
    },
    {
      fields: ['expires_at'],
    },
    {
      fields: ['status', 'expires_at'],
    },
    {
      fields: ['paid_by_user_id'],
    },
  ],
});

// Instance methods
PaymentRequest.prototype.canBePaid = function() {
  return this.status === 'active' && new Date() <= this.expires_at;
};

PaymentRequest.prototype.markAsPaid = async function(transactionId, paidByUserId, paidAmount, paidCurrency) {
  this.status = 'paid';
  this.paid_transaction_id = transactionId;
  this.paid_by_user_id = paidByUserId;
  this.paid_at = new Date();
  this.paid_amount = paidAmount;
  this.paid_currency = paidCurrency;
  return await this.save();
};

PaymentRequest.prototype.cancel = async function() {
  if (this.status === 'active') {
    this.status = 'cancelled';
    this.cancelled_at = new Date();
    return await this.save();
  }
  throw new Error('Cannot cancel a request that is not active');
};

// Static methods
PaymentRequest.cleanupExpired = async function() {
  const [affectedRows] = await this.update(
    {
      status: 'expired',
      updated_at: new Date()
    },
    {
      where: {
        status: 'active',
        expires_at: {
          [sequelize.Op.lt]: new Date()
        }
      }
    }
  );
  return affectedRows;
};

PaymentRequest.getUserSummary = async function(userId) {
  const result = await this.findAll({
    where: { from_user_id: userId },
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_requests'],
      [sequelize.fn('COUNT',
        sequelize.literal('CASE WHEN status = \'active\' THEN 1 END')
      ), 'active_requests'],
      [sequelize.fn('COUNT',
        sequelize.literal('CASE WHEN status = \'paid\' THEN 1 END')
      ), 'paid_requests'],
      [sequelize.fn('SUM', sequelize.col('amount')), 'total_amount_requested'],
      [sequelize.fn('SUM',
        sequelize.literal('CASE WHEN status = \'paid\' THEN amount ELSE 0 END')
      ), 'total_amount_received'],
    ],
    raw: true
  });

  return result[0] || {
    total_requests: 0,
    active_requests: 0,
    paid_requests: 0,
    total_amount_requested: 0,
    total_amount_received: 0
  };
};

// Associations
PaymentRequest.associate = (models) => {
  PaymentRequest.belongsTo(models.User, {
    foreignKey: 'from_user_id',
    as: 'from_user'
  });
  PaymentRequest.belongsTo(models.User, {
    foreignKey: 'to_user_id',
    as: 'to_user'
  });
  PaymentRequest.belongsTo(models.User, {
    foreignKey: 'paid_by_user_id',
    as: 'paid_by_user'
  });
  PaymentRequest.belongsTo(models.Transaction, {
    foreignKey: 'paid_transaction_id',
    as: 'paid_transaction'
  });
};

module.exports = PaymentRequest;