const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  // Wallet identification
  wallet_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // User association
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Wallet address
  address: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true
  },

  // Wallet type and provider
  type: {
    type: String,
    required: true,
    enum: [
      'metamask',      // MetaMask browser extension
      'walletconnect', // WalletConnect protocol
      'argent',        // Argent wallet
      'braavos',       // Braavos wallet
      'xverse',        // Xverse Bitcoin wallet
      'phantom',       // Phantom (Solana)
      'solflare',      // Solflare (Solana)
      'trust',         // Trust Wallet
      'rainbow',       // Rainbow Wallet
      'coinbase',      // Coinbase Wallet
      'other'
    ],
    index: true
  },

  // Wallet name/label
  name: {
    type: String,
    trim: true,
    maxlength: 50
  },

  // Network information
  network: {
    type: String,
    required: true,
    enum: [
      'ethereum',
      'polygon',
      'arbitrum',
      'optimism',
      'starknet',
      'bitcoin',
      'bitcoin_testnet',
      'solana',
      'bsc',
      'avalanche'
    ],
    index: true
  },

  // Wallet status
  status: {
    type: String,
    required: true,
    enum: [
      'active',     // Wallet is connected and active
      'inactive',   // Wallet is disconnected
      'suspended',  // Wallet is temporarily suspended
      'blocked'     // Wallet is permanently blocked
    ],
    default: 'active',
    index: true
  },

  // Connection information
  is_connected: {
    type: Boolean,
    default: false
  },
  last_connected_at: {
    type: Date
  },
  connection_count: {
    type: Number,
    default: 0,
    min: 0
  },

  // Balance information
  balances: [{
    symbol: {
      type: String,
      required: true,
      uppercase: true
    },
    name: {
      type: String,
      trim: true
    },
    balance: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0
    },
    balance_value_usd: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    contract_address: {
      type: String,
      trim: true,
      lowercase: true
    },
    decimals: {
      type: Number,
      min: 0,
      max: 18,
      default: 18
    },
    is_native: {
      type: Boolean,
      default: false
    },
    last_updated: {
      type: Date,
      default: Date.now
    }
  }],

  // Transaction history summary
  transaction_summary: {
    total_transactions: {
      type: Number,
      default: 0,
      min: 0
    },
    successful_transactions: {
      type: Number,
      default: 0,
      min: 0
    },
    failed_transactions: {
      type: Number,
      default: 0,
      min: 0
    },
    total_volume_usd: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      min: 0
    },
    last_transaction_at: {
      type: Date
    }
  },

  // Risk and security
  risk_score: {
    type: Number,
    min: 0,
    max: 100,
    default: 50
  },
  risk_level: {
    type: String,
    enum: ['low', 'medium', 'high', 'very_high'],
    default: 'medium'
  },
  is_whitelisted: {
    type: Boolean,
    default: false
  },
  daily_limit_usd: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    default: 10000 // $10,000 default daily limit
  },

  // Wallet features and capabilities
  capabilities: {
    send: {
      type: Boolean,
      default: true
    },
    receive: {
      type: Boolean,
      default: true
    },
    swap: {
      type: Boolean,
      default: false
    },
    stake: {
      type: Boolean,
      default: false
    },
    lend: {
      type: Boolean,
      default: false
    },
    nft_support: {
      type: Boolean,
      default: false
    },
    defi_support: {
      type: Boolean,
      default: false
    },
    hardware_wallet: {
      type: Boolean,
      default: false
    }
  },

  // Device and browser information
  device_info: {
    user_agent: String,
    ip_address: String,
    location: {
      country: String,
      city: String,
      timezone: String
    },
    last_login_device: String
  },

  // Backup and recovery
  backup_status: {
    type: String,
    enum: ['none', 'seed_phrase', 'private_key', 'social_recovery', 'hardware'],
    default: 'none'
  },
  recovery_email: {
    type: String,
    trim: true,
    lowercase: true
  },

  // Integration settings
  integrations: {
    portfolio_tracking: {
      type: Boolean,
      default: true
    },
    transaction_monitoring: {
      type: Boolean,
      default: true
    },
    defi_tracking: {
      type: Boolean,
      default: true
    },
    nft_tracking: {
      type: Boolean,
      default: false
    }
  },

  // Metadata
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 20
  }],
  notes: {
    type: String,
    trim: true,
    maxlength: 500
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },

  // Timestamps
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  last_sync: {
    type: Date,
    default: Date.now
  },
  deactivated_at: {
    type: Date
  }
});

// Indexes for performance
walletSchema.index({ user_id: 1, status: 1 });
walletSchema.index({ address: 1, network: 1 });
walletSchema.index({ type: 1, network: 1 });
walletSchema.index({ last_connected_at: -1 });
walletSchema.index({ 'balances.symbol': 1 });
walletSchema.index({ risk_score: -1 });

// Pre-save middleware
walletSchema.pre('save', function(next) {
  this.updated_at = new Date();

  // Set deactivated_at when status changes to inactive/blocked
  if (this.isModified('status') && ['inactive', 'blocked'].includes(this.status) && !this.deactivated_at) {
    this.deactivated_at = new Date();
  }

  next();
});

// Virtual for total balance value
walletSchema.virtual('total_balance_usd').get(function() {
  return this.balances.reduce((sum, balance) => {
    return sum + parseFloat(balance.balance_value_usd?.toString() || '0');
  }, 0);
});

// Virtual for wallet age
walletSchema.virtual('age_days').get(function() {
  return Math.floor((Date.now() - this.created_at.getTime()) / (1000 * 60 * 60 * 24));
});

// Method to check if wallet is active
walletSchema.methods.isActive = function() {
  return this.status === 'active' && this.is_connected;
};

// Method to update balance
walletSchema.methods.updateBalance = function(symbol, newBalance, newValueUsd) {
  const balanceIndex = this.balances.findIndex(b => b.symbol === symbol);

  if (balanceIndex >= 0) {
    this.balances[balanceIndex].balance = newBalance;
    this.balances[balanceIndex].balance_value_usd = newValueUsd;
    this.balances[balanceIndex].last_updated = new Date();
  } else {
    this.balances.push({
      symbol,
      balance: newBalance,
      balance_value_usd: newValueUsd,
      last_updated: new Date()
    });
  }

  return this.save();
};

// Method to connect wallet
walletSchema.methods.connect = function(deviceInfo = {}) {
  this.is_connected = true;
  this.last_connected_at = new Date();
  this.connection_count += 1;

  if (deviceInfo) {
    this.device_info = { ...this.device_info, ...deviceInfo };
  }

  return this.save();
};

// Method to disconnect wallet
walletSchema.methods.disconnect = function() {
  this.is_connected = false;
  return this.save();
};

// Method to check daily limit
walletSchema.methods.checkDailyLimit = async function(amountUsd) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get today's transactions for this wallet
  const Transaction = mongoose.model('Transaction');
  const todayVolume = await Transaction.aggregate([
    {
      $match: {
        $or: [
          { from_address: this.address },
          { to_address: this.address }
        ],
        created_at: { $gte: today },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: null,
        total_volume: { $sum: '$value_usd' }
      }
    }
  ]);

  const currentVolume = todayVolume[0]?.total_volume || 0;
  const dailyLimit = parseFloat(this.daily_limit_usd.toString());

  return (currentVolume + amountUsd) <= dailyLimit;
};

// Static method to get user wallets
walletSchema.statics.getUserWallets = async function(userId, includeBalances = true) {
  const query = this.find({ user_id: userId, status: 'active' });

  if (includeBalances) {
    query.select('+balances');
  }

  return query.sort({ last_connected_at: -1 });
};

// Static method to get wallet by address and network
walletSchema.statics.findByAddressAndNetwork = function(address, network) {
  return this.findOne({
    address: address.toLowerCase(),
    network,
    status: 'active'
  });
};

module.exports = mongoose.model('Wallet', walletSchema);