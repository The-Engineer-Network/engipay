const mongoose = require('mongoose');

const defiPositionSchema = new mongoose.Schema({
  // Position identification
  position_id: {
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

  // Protocol information
  protocol: {
    type: String,
    required: true,
    enum: [
      'vesu',      // Starknet lending protocol
      'zkLend',    // Starknet lending protocol
      'aave',      // Ethereum lending protocol
      'compound',  // Ethereum lending protocol
      'uniswap',   // Ethereum DEX
      'sushiswap', // Ethereum DEX
      'curve',     // Ethereum stablecoin AMM
      'yearn',     // Ethereum yield aggregator
      'convex',    // Ethereum yield booster
      'lido',      // Ethereum staking
      'rocketpool', // Ethereum staking
      'makerdao',  // Ethereum CDP
      'other'
    ],
    index: true
  },

  protocol_name: {
    type: String,
    trim: true
  },

  // Position type
  type: {
    type: String,
    required: true,
    enum: [
      'supply',        // Lending assets
      'borrow',        // Borrowing assets
      'liquidity',     // Providing liquidity
      'staking',       // Staking tokens
      'farming',       // Yield farming
      'vault',         // Yield vault deposit
      'cdp',          // Collateralized debt position
      'derivative'     // Derivatives position
    ],
    index: true
  },

  // Position status
  status: {
    type: String,
    required: true,
    enum: [
      'active',       // Position is active
      'inactive',     // Position is closed
      'liquidating',  // Position is being liquidated
      'liquidated',   // Position has been liquidated
      'failed'        // Position creation failed
    ],
    default: 'active',
    index: true
  },

  // Asset information
  assets: [{
    symbol: {
      type: String,
      required: true,
      uppercase: true
    },
    name: {
      type: String,
      trim: true
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      required: true,
      min: 0
    },
    amount_value_usd: {
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
    is_collateral: {
      type: Boolean,
      default: false
    },
    is_borrowed: {
      type: Boolean,
      default: false
    }
  }],

  // Financial metrics
  principal_amount: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  principal_value_usd: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },

  current_amount: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  current_value_usd: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },

  // Interest/APY information
  apy: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  variable_apy: {
    type: Boolean,
    default: true
  },
  accrued_interest: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0,
    min: 0
  },

  // Debt information (for borrowing positions)
  debt_amount: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  debt_value_usd: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  debt_asset: {
    symbol: String,
    name: String,
    contract_address: String
  },

  // Risk metrics
  health_factor: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  liquidation_threshold: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    max: 100
  },
  liquidation_price: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  max_ltv: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    max: 100
  },

  // Rewards information
  rewards: [{
    asset_symbol: {
      type: String,
      uppercase: true
    },
    asset_name: {
      type: String,
      trim: true
    },
    amount: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    amount_value_usd: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    apy: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    claimable: {
      type: Boolean,
      default: false
    },
    claimed: {
      type: Boolean,
      default: false
    }
  }],

  // Transaction information
  deposit_transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  withdraw_transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  last_transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },

  // Protocol specific data
  protocol_data: {
    pool_id: String,
    pool_address: String,
    position_address: String,
    vault_id: String,
    farm_id: String,
    lock_period_days: Number,
    lock_expires_at: Date,
    metadata: mongoose.Schema.Types.Mixed
  },

  // Network information
  network: {
    type: String,
    required: true,
    enum: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin'],
    index: true
  },

  // Performance tracking
  performance: {
    total_earned: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      min: 0
    },
    total_earned_value_usd: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0,
      min: 0
    },
    realized_pnl: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0
    },
    unrealized_pnl: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0
    },
    impermanent_loss: {
      type: mongoose.Schema.Types.Decimal128,
      default: 0
    }
  },

  // Alerts and notifications
  alerts: {
    health_factor_warning: {
      type: Boolean,
      default: false
    },
    liquidation_warning: {
      type: Boolean,
      default: false
    },
    rewards_available: {
      type: Boolean,
      default: false
    }
  },

  // Metadata
  tags: [{
    type: String,
    trim: true,
    lowercase: true
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
  closed_at: {
    type: Date
  },
  last_sync: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
defiPositionSchema.index({ user_id: 1, status: 1, created_at: -1 });
defiPositionSchema.index({ protocol: 1, type: 1 });
defiPositionSchema.index({ network: 1, protocol: 1 });
defiPositionSchema.index({ 'assets.symbol': 1 });
defiPositionSchema.index({ health_factor: 1 });
defiPositionSchema.index({ last_sync: 1 });

// Pre-save middleware
defiPositionSchema.pre('save', function(next) {
  this.updated_at = new Date();

  // Set closed_at when status changes to inactive
  if (this.isModified('status') && this.status === 'inactive' && !this.closed_at) {
    this.closed_at = new Date();
  }

  next();
});

// Virtual for position age
defiPositionSchema.virtual('age_days').get(function() {
  return Math.floor((Date.now() - this.created_at.getTime()) / (1000 * 60 * 60 * 24));
});

// Virtual for total value
defiPositionSchema.virtual('total_value_usd').get(function() {
  const assetValue = this.assets.reduce((sum, asset) => {
    return sum + parseFloat(asset.amount_value_usd?.toString() || '0');
  }, 0);

  const rewardValue = this.rewards.reduce((sum, reward) => {
    return sum + parseFloat(reward.amount_value_usd?.toString() || '0');
  }, 0);

  return assetValue + rewardValue;
});

// Method to check if position is at risk
defiPositionSchema.methods.isAtRisk = function() {
  if (!this.health_factor) return false;
  const hf = parseFloat(this.health_factor.toString());
  return hf < 1.2; // Warning threshold
};

// Method to check if position is liquidatable
defiPositionSchema.methods.isLiquidatable = function() {
  if (!this.health_factor) return false;
  const hf = parseFloat(this.health_factor.toString());
  return hf < 1.0;
};

// Method to calculate total rewards earned
defiPositionSchema.methods.getTotalRewardsValue = function() {
  return this.rewards.reduce((sum, reward) => {
    return sum + parseFloat(reward.amount_value_usd?.toString() || '0');
  }, 0);
};

// Method to close position
defiPositionSchema.methods.close = function() {
  if (this.status === 'active') {
    this.status = 'inactive';
    this.closed_at = new Date();
    return this.save();
  }
  throw new Error('Cannot close a position that is not active');
};

// Static method to get user positions summary
defiPositionSchema.statics.getUserSummary = async function(userId) {
  const result = await this.aggregate([
    {
      $match: { user_id: mongoose.Types.ObjectId(userId), status: 'active' }
    },
    {
      $group: {
        _id: null,
        total_positions: { $sum: 1 },
        total_value_locked: {
          $sum: {
            $reduce: {
              input: '$assets.amount_value_usd',
              initialValue: 0,
              in: { $add: ['$$value', '$$this'] }
            }
          }
        },
        total_debt: { $sum: '$debt_value_usd' },
        total_rewards: {
          $sum: {
            $reduce: {
              input: '$rewards.amount_value_usd',
              initialValue: 0,
              in: { $add: ['$$value', '$$this'] }
            }
          }
        },
        at_risk_positions: {
          $sum: {
            $cond: [
              { $and: [
                { $ne: ['$health_factor', null] },
                { $lt: ['$health_factor', 1.2] }
              ]},
              1,
              0
            ]
          }
        }
      }
    }
  ]);

  return result[0] || {
    total_positions: 0,
    total_value_locked: 0,
    total_debt: 0,
    total_rewards: 0,
    at_risk_positions: 0
  };
};

module.exports = mongoose.model('DeFiPosition', defiPositionSchema);