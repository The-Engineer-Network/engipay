const mongoose = require('mongoose');

const yieldFarmSchema = new mongoose.Schema({
  // Farm identification
  farm_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // Protocol information
  protocol: {
    type: String,
    required: true,
    enum: [
      'uniswap',     // Uniswap V3 farms
      'sushiswap',   // SushiSwap farms
      'pancakeswap', // PancakeSwap farms
      'curve',       // Curve Finance
      'balancer',    // Balancer
      'yearn',       // Yearn Finance
      'convex',      // Convex Finance
      'compound',    // Compound
      'aave',        // Aave
      'vesu',        // Vesu (Starknet)
      'zkLend',      // zkLend (Starknet)
      'other'
    ],
    index: true
  },

  protocol_name: {
    type: String,
    trim: true
  },

  // Farm details
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },

  // Farm type
  type: {
    type: String,
    required: true,
    enum: [
      'liquidity_pool',    // LP token staking
      'single_stake',      // Single token staking
      'dual_farm',         // Farming two tokens
      'vault',             // Yield vault
      'auto_compound',     // Auto-compounding vault
      'leveraged',         // Leveraged farming
      'other'
    ],
    index: true
  },

  // Farm status
  status: {
    type: String,
    required: true,
    enum: [
      'active',     // Farm is active
      'inactive',   // Farm is closed
      'deprecated', // Farm is deprecated
      'paused'      // Farm is temporarily paused
    ],
    default: 'active',
    index: true
  },

  // Network information
  network: {
    type: String,
    required: true,
    enum: ['ethereum', 'polygon', 'arbitrum', 'optimism', 'starknet', 'bsc', 'avalanche'],
    index: true
  },

  // Contract addresses
  farm_contract_address: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  reward_contract_address: {
    type: String,
    trim: true,
    lowercase: true
  },
  lp_token_address: {
    type: String,
    trim: true,
    lowercase: true
  },

  // Token information
  staking_token: {
    symbol: {
      type: String,
      required: true,
      uppercase: true
    },
    name: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true,
      lowercase: true
    },
    decimals: {
      type: Number,
      min: 0,
      max: 18,
      default: 18
    }
  },

  reward_tokens: [{
    symbol: {
      type: String,
      required: true,
      uppercase: true
    },
    name: {
      type: String,
      trim: true
    },
    address: {
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
    reward_rate: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    total_rewards: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    remaining_rewards: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    }
  }],

  // Farm metrics
  tvl: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    default: 0
  },
  tvl_change_24h: {
    type: mongoose.Schema.Types.Decimal128,
    default: 0
  },

  total_staked: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    default: 0
  },

  // APY information
  apy: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  base_apy: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  reward_apy: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },

  // Risk metrics
  risk_level: {
    type: String,
    enum: ['low', 'medium', 'high', 'very_high'],
    default: 'medium'
  },
  impermanent_loss_risk: {
    type: String,
    enum: ['none', 'low', 'medium', 'high', 'very_high'],
    default: 'none'
  },

  // Farm parameters
  min_stake_amount: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  max_stake_amount: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0
  },
  lock_period_days: {
    type: Number,
    min: 0
  },
  withdrawal_fee: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    max: 100
  },
  performance_fee: {
    type: mongoose.Schema.Types.Decimal128,
    min: 0,
    max: 100
  },

  // Farm statistics
  total_stakers: {
    type: Number,
    min: 0,
    default: 0
  },
  active_stakers: {
    type: Number,
    min: 0,
    default: 0
  },

  // Historical performance
  performance_history: [{
    date: {
      type: Date,
      required: true
    },
    tvl: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    apy: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    },
    total_staked: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0
    }
  }],

  // Tags and categories
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 20
  }],
  category: {
    type: String,
    enum: [
      'dex',
      'lending',
      'staking',
      'liquidity',
      'yield',
      'vault',
      'other'
    ],
    default: 'other'
  },

  // External links
  links: {
    website: String,
    docs: String,
    discord: String,
    telegram: String,
    twitter: String,
    github: String
  },

  // Metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed
  },

  // Timestamps
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  },
  ends_at: {
    type: Date
  },
  last_sync: {
    type: Date,
    default: Date.now
  }
});

// Indexes for performance
yieldFarmSchema.index({ protocol: 1, network: 1 });
yieldFarmSchema.index({ type: 1, status: 1 });
yieldFarmSchema.index({ tvl: -1 });
yieldFarmSchema.index({ apy: -1 });
yieldFarmSchema.index({ network: 1, status: 1 });
yieldFarmSchema.index({ farm_contract_address: 1 });
yieldFarmSchema.index({ last_sync: 1 });

// Pre-save middleware
yieldFarmSchema.pre('save', function(next) {
  this.updated_at = new Date();
  next();
});

// Virtual for whether farm is expired
yieldFarmSchema.virtual('is_expired').get(function() {
  return this.ends_at && new Date() > this.ends_at;
});

// Virtual for days until expiration
yieldFarmSchema.virtual('days_until_expiry').get(function() {
  if (!this.ends_at) return null;
  return Math.max(0, Math.floor((this.ends_at.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
});

// Method to check if farm is active
yieldFarmSchema.methods.isActive = function() {
  return this.status === 'active' && !this.is_expired;
};

// Method to calculate estimated daily rewards
yieldFarmSchema.methods.getEstimatedDailyRewards = function(stakeAmount) {
  if (!this.apy || !stakeAmount) return 0;

  const apy = parseFloat(this.apy.toString());
  const stake = parseFloat(stakeAmount.toString());

  // Daily rewards = (stake * APY) / 365
  return (stake * apy) / 365;
};

// Method to get farm score (for ranking)
yieldFarmSchema.methods.getFarmScore = function() {
  let score = 0;

  // TVL weight (higher TVL = higher score)
  const tvl = parseFloat(this.tvl?.toString() || '0');
  score += Math.min(tvl / 1000000, 50); // Max 50 points for TVL

  // APY weight (higher APY = higher score, but cap at reasonable levels)
  const apy = parseFloat(this.apy?.toString() || '0');
  score += Math.min(apy / 10, 30); // Max 30 points for APY

  // Risk penalty
  const riskMultiplier = this.risk_level === 'low' ? 1.2 :
                        this.risk_level === 'medium' ? 1.0 :
                        this.risk_level === 'high' ? 0.8 : 0.5;
  score *= riskMultiplier;

  return Math.round(score);
};

// Static method to get top farms by network
yieldFarmSchema.statics.getTopFarms = async function(network, limit = 10, category = null) {
  const query = {
    network,
    status: 'active',
    $or: [
      { ends_at: { $exists: false } },
      { ends_at: { $gt: new Date() } }
    ]
  };

  if (category) {
    query.category = category;
  }

  return this.find(query)
    .sort({ apy: -1, tvl: -1 })
    .limit(limit)
    .select('farm_id name protocol apy tvl reward_tokens tags category');
};

// Static method to get farms by protocol
yieldFarmSchema.statics.getFarmsByProtocol = async function(protocol, network = null) {
  const query = { protocol, status: 'active' };

  if (network) {
    query.network = network;
  }

  return this.find(query)
    .sort({ apy: -1 })
    .select('farm_id name network apy tvl reward_tokens tags');
};

module.exports = mongoose.model('YieldFarm', yieldFarmSchema);