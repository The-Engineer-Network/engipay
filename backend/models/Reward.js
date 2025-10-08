const mongoose = require('mongoose');

const rewardSchema = new mongoose.Schema({
  // Reward identification
  reward_id: {
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

  // Related position (DeFi position that generated this reward)
  position_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DeFiPosition',
    index: true
  },

  // Related farm (for farming rewards)
  farm_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'YieldFarm',
    index: true
  },

  // Protocol information
  protocol: {
    type: String,
    required: true,
    enum: [
      'vesu',        // Starknet lending
      'zkLend',      // Starknet lending
      'aave',        // Ethereum lending
      'compound',    // Ethereum lending
      'uniswap',     // Uniswap V3
      'sushiswap',   // SushiSwap
      'curve',       // Curve Finance
      'balancer',    // Balancer
      'yearn',       // Yearn Finance
      'convex',      // Convex Finance
      'lido',        // Lido staking
      'rocketpool',  // Rocket Pool staking
      'other'
    ],
    index: true
  },

  // Reward type
  type: {
    type: String,
    required: true,
    enum: [
      'staking_reward',     // Staking rewards
      'farming_reward',     // Yield farming rewards
      'trading_fee',        // Trading fee rewards
      'liquidity_mining',   // Liquidity mining rewards
      'governance',         // Governance token rewards
      'airdrop',           // Airdrop rewards
      'referral',          // Referral rewards
      'bonus',             // Bonus rewards
      'other'
    ],
    index: true
  },

  // Reward status
  status: {
    type: String,
    required: true,
    enum: [
      'pending',      // Reward is accumulating
      'claimable',    // Reward is available to claim
      'claimed',      // Reward has been claimed
      'expired',      // Reward has expired
      'forfeited'     // Reward was forfeited
    ],
    default: 'pending',
    index: true
  },

  // Token information
  token_symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  token_name: {
    type: String,
    trim: true
  },
  token_address: {
    type: String,
    trim: true,
    lowercase: true
  },
  token_decimals: {
    type: Number,
    min: 0,
    max: 18,
    default: 18
  },

  // Reward amounts
  amount: {
    type: mongoose.Schema.Types.Decimal128,
    required: true,
    min: 0
  },
  amount_value_usd: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },

  // Claimed information
  claimed_amount: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  claimed_value_usd: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  claimed_at: {
    type: Date
  },

  // Transaction information
  claim_transaction_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  claim_tx_hash: {
    type: String,
    trim: true,
    lowercase: true
  },

  // Network information
  network: {
    type: String,
    required: true,
    enum: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bitcoin'],
    index: true
  },

  // Reward period
  period_start: {
    type: Date,
    required: true
  },
  period_end: {
    type: Date,
    required: true
  },

  // APY/Rate information
  apy: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  reward_rate: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },

  // Expiration and vesting
  expires_at: {
    type: Date
  },
  vesting_period_days: {
    type: Number,
    min: 0
  },
  vesting_start_date: {
    type: Date
  },

  // Lock-up information
  lock_period_days: {
    type: Number,
    min: 0
  },
  unlock_date: {
    type: Date
  },

  // Risk and compliance
  risk_score: {
    type: Number,
    min: 0,
    max: 100
  },
  flagged_for_review: {
    type: Boolean,
    default: false
  },

  // Metadata
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 20
  }],
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
  last_accrued_at: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
rewardSchema.index({ user_id: 1, status: 1, created_at: -1 });
rewardSchema.index({ position_id: 1, status: 1 });
rewardSchema.index({ farm_id: 1, status: 1 });
rewardSchema.index({ protocol: 1, type: 1 });
rewardSchema.index({ network: 1, status: 1 });
rewardSchema.index({ expires_at: 1 });
rewardSchema.index({ period_end: 1 });

// Pre-save middleware
rewardSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Virtual for whether reward is expired
rewardSchema.virtual('is_expired').get(function() {
  return this.expires_at && new Date() > this.expires_at;
});

// Virtual for whether reward is claimable
rewardSchema.virtual('is_claimable').get(function() {
  return this.status === 'claimable' && !this.is_expired;
});

// Virtual for days until expiration
rewardSchema.virtual('days_until_expiry').get(function() {
  if (!this.expires_at) return null;
  return Math.max(0, Math.floor((this.expires_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
});

// Virtual for vesting progress
rewardSchema.virtual('vesting_progress').get(function() {
  if (!this.vesting_start_date || !this.vesting_period_days) return 1;

  const elapsed = Date.now() - this.vesting_start_date.getTime();
  const total = this.vesting_period_days * 24 * 60 * 60 * 1000;

  return Math.min(elapsed / total, 1);
});

// Method to check if reward can be claimed
rewardSchema.methods.canBeClaimed = function() {
  return this.is_claimable && (!this.vesting_progress || this.vesting_progress >= 1);
};

// Method to mark as claimed
rewardSchema.methods.markAsClaimed = function(claimedAmount, transactionId, txHash) {
  if (this.status !== 'claimable') {
    throw new Error('Reward is not in claimable status');
  }

  this.status = 'claimed';
  this.claimed_amount = claimedAmount;
  this.claim_transaction_id = transactionId;
  this.claim_tx_hash = txHash;
  this.claimed_at = new Date();

  return this.save();
};

// Method to forfeit reward
rewardSchema.methods.forfeit = function() {
  if (this.status === 'claimed') {
    throw new Error('Cannot forfeit a claimed reward');
  }

  this.status = 'forfeited';
  return this.save();
};

// Static method to get user claimable rewards
rewardSchema.statics.getUserClaimableRewards = async function(userId) {
  return this.find({
    user_id: userId,
    status: 'claimable',
    $or: [
      { expires_at: { $exists: false } },
      { expires_at: { $gt: new Date() } }
    ]
  })
  .populate('position_id', 'protocol type assets')
  .populate('farm_id', 'protocol name')
  .sort({ amount_value_usd: -1 });
};

// Static method to get user rewards summary
rewardSchema.statics.getUserRewardsSummary = async function(userId, timeframe = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - timeframe);

  const result = await this.aggregate([
    {
      $match: {
        user_id: mongoose.Types.ObjectId(userId),
        created_at: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: null,
        total_pending: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'pending'] },
              '$amount_value_usd',
              0
            ]
          }
        },
        total_claimable: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'claimable'] },
              '$amount_value_usd',
              0
            ]
          }
        },
        total_claimed: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'claimed'] },
              '$claimed_value_usd',
              0
            ]
          }
        },
        total_expired: {
          $sum: {
            $cond: [
              { $eq: ['$status', 'expired'] },
              '$amount_value_usd',
              0
            ]
          }
        }
      }
    }
  ]);

  return result[0] || {
    total_pending: 0,
    total_claimable: 0,
    total_claimed: 0,
    total_expired: 0
  };
};

module.exports = mongoose.model('Reward', rewardSchema);