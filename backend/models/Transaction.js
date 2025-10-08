const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Transaction = sequelize.define('Transaction', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },

  // Transaction identification
  transaction_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  external_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },

  // User association
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Users',
      key: 'id'
    }
  },

  // Transaction type and category
  transaction_type: {
    type: DataTypes.ENUM(
      'payment_send',
      'payment_receive',
      'payment_request',
      'swap',
      'defi_deposit',
      'defi_withdraw',
      'defi_claim_rewards',
      'defi_lend',
      'defi_borrow',
      'defi_repay',
      'nft_purchase',
      'nft_sale',
      'token_purchase',
      'fee',
      'refund',
      'chargeback'
    ),
    allowNull: false,
  },

  category: {
    type: DataTypes.ENUM(
      'payment',
      'swap',
      'defi',
      'nft',
      'fee',
      'refund',
      'other'
    ),
    defaultValue: 'other',
  },

  // Transaction details
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  memo: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },

  // Amount and currency
  amount: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
  },
  asset_symbol: {
    type: DataTypes.STRING(20),
    allowNull: false,
  },
  amount_crypto: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: true,
  },
  crypto_currency: {
    type: DataTypes.ENUM('BTC', 'ETH', 'STRK', 'USDT', 'USDC'),
    allowNull: true,
  },

  // Exchange rates and values
  exchange_rate: {
    type: DataTypes.DECIMAL(20, 10),
    allowNull: true,
  },
  value_usd: {
    type: DataTypes.DECIMAL(20, 2),
    allowNull: true,
  },

  // Counterparty information
  from_address: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  to_address: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  counterparty_user_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Users',
      key: 'id'
    }
  },
  counterparty_name: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },

  // Blockchain information
  network: {
    type: DataTypes.ENUM(
      'ethereum',
      'polygon',
      'arbitrum',
      'optimism',
      'starknet',
      'bitcoin',
      'bitcoin_testnet'
    ),
    allowNull: true,
  },
  tx_hash: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  block_number: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  gas_used: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  gas_price: {
    type: DataTypes.DECIMAL(20, 0),
    allowNull: true,
  },
  gas_limit: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  confirmations: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
  },

  // Transaction status
  status: {
    type: DataTypes.ENUM(
      'pending',
      'processing',
      'completed',
      'failed',
      'cancelled',
      'refunded',
      'chargeback',
      'disputed'
    ),
    defaultValue: 'pending',
  },

  // Failure information
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  failure_code: {
    type: DataTypes.STRING(50),
    allowNull: true,
  },

  // Fee information
  fee_amount: {
    type: DataTypes.DECIMAL(36, 18),
    defaultValue: 0,
  },
  fee_asset: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  network_fee: {
    type: DataTypes.DECIMAL(36, 18),
    defaultValue: 0,
  },

  // Service provider information
  service_provider: {
    type: DataTypes.ENUM(
      'chipipay',
      'atomiq',
      'vesu',
      'internal',
      'stripe',
      'paypal',
      'other'
    ),
    defaultValue: 'internal',
  },
  service_transaction_id: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },

  // Risk and compliance
  risk_score: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: {
      min: 0,
      max: 100,
    },
  },
  risk_level: {
    type: DataTypes.ENUM('low', 'medium', 'high', 'very_high'),
    defaultValue: 'low',
  },
  flagged_for_review: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  review_reason: {
    type: DataTypes.TEXT,
    allowNull: true,
  },

  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
  },

  // Related transactions
  related_transaction_id: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'Transactions',
      key: 'id'
    }
  },

  // Completion timestamps
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  failed_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
}, {
  // Model options
  indexes: [
    {
      fields: ['user_id', 'created_at'],
    },
    {
      fields: ['transaction_type', 'status'],
    },
    {
      fields: ['category', 'created_at'],
    },
    {
      fields: ['network', 'tx_hash'],
    },
    {
      fields: ['status', 'created_at'],
    },
    {
      fields: ['counterparty_user_id'],
    },
    {
      fields: ['service_provider', 'service_transaction_id'],
    },
    {
      fields: ['transaction_id'],
      unique: true,
    },
  ],
});

// Instance methods
Transaction.prototype.isSuccessful = function() {
  return ['completed', 'refunded'].includes(this.status);
};

Transaction.prototype.isPending = function() {
  return ['pending', 'processing'].includes(this.status);
};

Transaction.prototype.isFailed = function() {
  return ['failed', 'cancelled', 'chargeback'].includes(this.status);
};

// Static methods
Transaction.getUserSummary = async function(userId, timeframe = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframe);

  const result = await this.findAll({
    where: {
      user_id: userId,
      created_at: {
        [sequelize.Op.gte]: startDate
      }
    },
    attributes: [
      [sequelize.fn('COUNT', sequelize.col('id')), 'total_transactions'],
      [sequelize.fn('SUM', sequelize.col('value_usd')), 'total_volume'],
      [sequelize.fn('COUNT',
        sequelize.literal('CASE WHEN status IN (\'completed\', \'refunded\') THEN 1 END')
      ), 'successful_transactions'],
      [sequelize.fn('COUNT',
        sequelize.literal('CASE WHEN status IN (\'failed\', \'cancelled\') THEN 1 END')
      ), 'failed_transactions'],
    ],
    raw: true
  });

  return result[0] || {
    total_transactions: 0,
    total_volume: 0,
    successful_transactions: 0,
    failed_transactions: 0
  };
};

// Associations
Transaction.associate = (models) => {
  Transaction.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
  Transaction.belongsTo(models.User, {
    foreignKey: 'counterparty_user_id',
    as: 'counterparty'
  });
  Transaction.belongsTo(Transaction, {
    foreignKey: 'related_transaction_id',
    as: 'related_transaction'
  });
};

module.exports = Transaction;