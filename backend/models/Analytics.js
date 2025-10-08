const mongoose = require('mongoose');

const analyticsSchema = new mongoose.Schema({
  // Analytics entry identification
  analytics_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },

  // User association (null for global analytics)
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true
  },

  // Analytics type
  type: {
    type: String,
    required: true,
    enum: [
      'user_activity',        // User activity tracking
      'transaction_volume',   // Transaction volume metrics
      'defi_performance',     // DeFi performance metrics
      'portfolio_performance', // Portfolio performance
      'system_usage',         // System usage statistics
      'error_tracking',       // Error tracking
      'conversion_funnel',    // User conversion metrics
      'retention_metrics',    // User retention analytics
      'revenue_metrics',      // Revenue and monetization
      'geographic_usage',     // Geographic usage patterns
      'device_analytics',     // Device and browser analytics
      'feature_usage',        // Feature usage tracking
      'other'
    ],
    index: true
  },

  // Time period
  period: {
    type: String,
    required: true,
    enum: [
      'minute',     // Per minute
      'hourly',     // Per hour
      'daily',      // Per day
      'weekly',     // Per week
      'monthly',    // Per month
      'quarterly',  // Per quarter
      'yearly'      // Per year
    ],
    index: true
  },

  // Date range
  start_date: {
    type: Date,
    required: true,
    index: true
  },
  end_date: {
    type: Date,
    required: true,
    index: true
  },

  // Metrics data
  metrics: {
    // User metrics
    user_metrics: {
      active_users: Number,
      new_users: Number,
      returning_users: Number,
      churned_users: Number,
      user_engagement_score: Number,
      session_duration_avg: Number,
      page_views_per_session: Number
    },

    // Transaction metrics
    transaction_metrics: {
      total_transactions: Number,
      successful_transactions: Number,
      failed_transactions: Number,
      total_volume_usd: mongoose.Schema.Types.Decimal128,
      avg_transaction_value: mongoose.Schema.Types.Decimal128,
      transaction_success_rate: Number,
      transactions_by_type: mongoose.Schema.Types.Mixed,
      transactions_by_network: mongoose.Schema.Types.Mixed
    },

    // DeFi metrics
    defi_metrics: {
      total_value_locked: mongoose.Schema.Types.Decimal128,
      total_positions: Number,
      active_positions: Number,
      liquidated_positions: Number,
      total_rewards_distributed: mongoose.Schema.Types.Decimal128,
      avg_apy: Number,
      positions_by_protocol: mongoose.Schema.Types.Mixed,
      tvl_by_protocol: mongoose.Schema.Types.Mixed
    },

    // Portfolio metrics
    portfolio_metrics: {
      total_portfolio_value: mongoose.Schema.Types.Decimal128,
      avg_portfolio_value: mongoose.Schema.Types.Decimal128,
      portfolio_diversification_score: Number,
      top_holdings: mongoose.Schema.Types.Mixed,
      portfolio_performance: {
        total_return: mongoose.Schema.Types.Decimal128,
        total_return_percent: mongoose.Schema.Types.Decimal128,
        best_performing_asset: String,
        worst_performing_asset: String
      }
    },

    // System metrics
    system_metrics: {
      api_requests_total: Number,
      api_response_time_avg: Number,
      error_rate: Number,
      uptime_percentage: Number,
      server_load_avg: Number,
      database_query_time_avg: Number
    },

    // Geographic metrics
    geographic_metrics: {
      top_countries: [{
        country: String,
        user_count: Number,
        transaction_volume: mongoose.Schema.Types.Decimal128
      }],
      user_distribution: mongoose.Schema.Types.Mixed
    },

    // Device metrics
    device_metrics: {
      desktop_users: Number,
      mobile_users: Number,
      tablet_users: Number,
      top_browsers: mongoose.Schema.Types.Mixed,
      top_devices: mongoose.Schema.Types.Mixed
    },

    // Feature usage metrics
    feature_metrics: {
      wallet_connections: Number,
      swaps_executed: Number,
      payments_sent: Number,
      defi_positions_created: Number,
      nfts_viewed: Number,
      features_used: mongoose.Schema.Types.Mixed
    },

    // Revenue metrics
    revenue_metrics: {
      total_revenue: mongoose.Schema.Types.Decimal128,
      transaction_fees: mongoose.Schema.Types.Decimal128,
      subscription_revenue: mongoose.Schema.Types.Decimal128,
      premium_features_revenue: mongoose.Schema.Types.Decimal128,
      avg_revenue_per_user: mongoose.Schema.Types.Decimal128
    },

    // Custom metrics (flexible field for additional data)
    custom_metrics: mongoose.Schema.Types.Mixed
  },

  // Aggregation level
  aggregation_level: {
    type: String,
    enum: ['user', 'global', 'protocol', 'network', 'feature'],
    default: 'global',
    index: true
  },

  // Filters applied (for tracking what filters were used)
  filters: {
    user_segment: String,
    protocol: String,
    network: String,
    asset: String,
    country: String,
    device_type: String,
    custom_filters: mongoose.Schema.Types.Mixed
  },

  // Data quality indicators
  data_quality: {
    completeness_score: {
      type: Number,
      min: 0,
      max: 100
    },
    accuracy_score: {
      type: Number,
      min: 0,
      max: 100
    },
    timeliness_score: {
      type: Number,
      min: 0,
      max: 100
    },
    data_sources: [String],
    last_data_refresh: Date
  },

  // Performance indicators
  performance_indicators: {
    query_execution_time: Number,
    data_processing_time: Number,
    cache_hit_rate: Number,
    error_count: Number
  },

  // Metadata
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 20
  }],
  description: {
    type: String,
    trim: true,
    maxlength: 500
  },
  source: {
    type: String,
    enum: ['system', 'manual', 'api', 'integration', 'calculated'],
    default: 'system'
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
  expires_at: {
    type: Date
  }
});

// Indexes for performance
analyticsSchema.index({ type: 1, period: 1, start_date: 1, end_date: 1 });
analyticsSchema.index({ user_id: 1, type: 1, created_at: -1 });
analyticsSchema.index({ aggregation_level: 1, type: 1 });
analyticsSchema.index({ expires_at: 1 });

// Pre-save middleware
analyticsSchema.pre('save', function(next) {
  this.updated_at = new Date();

  // Set expiration for time-series data (keep for 1 year)
  if (!this.expires_at) {
    const expirationDate = new Date(this.created_at);
    expirationDate.setFullYear(expirationDate.getFullYear() + 1);
    this.expires_at = expirationDate;
  }

  next();
});

// Virtual for whether data is expired
analyticsSchema.virtual('is_expired').get(function() {
  return this.expires_at && new Date() > this.expires_at;
});

// Method to check data freshness
analyticsSchema.methods.isFresh = function(maxAgeHours = 24) {
  const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds
  return (Date.now() - this.updated_at.getTime()) < maxAge;
};

// Method to get metric value by path
analyticsSchema.methods.getMetric = function(path) {
  const keys = path.split('.');
  let value = this.metrics;

  for (const key of keys) {
    if (value && typeof value === 'object') {
      value = value[key];
    } else {
      return null;
    }
  }

  return value;
};

// Method to update metric
analyticsSchema.methods.updateMetric = function(path, value) {
  const keys = path.split('.');
  let current = this.metrics;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  current[keys[keys.length - 1]] = value;
  this.updated_at = new Date();

  return this.save();
};

// Static method to get analytics for date range
analyticsSchema.statics.getAnalyticsForRange = async function(type, startDate, endDate, userId = null) {
  const query = {
    type,
    start_date: { $gte: startDate },
    end_date: { $lte: endDate },
    expires_at: { $gt: new Date() }
  };

  if (userId) {
    query.user_id = userId;
  }

  return this.find(query).sort({ start_date: 1 });
};

// Static method to get latest analytics
analyticsSchema.statics.getLatestAnalytics = async function(type, userId = null) {
  const query = { type };

  if (userId) {
    query.user_id = userId;
  }

  return this.findOne(query)
    .sort({ created_at: -1 })
    .limit(1);
};

// Static method to aggregate metrics
analyticsSchema.statics.aggregateMetrics = async function(type, period, startDate, endDate, userId = null) {
  const matchStage = {
    type,
    period,
    start_date: { $gte: startDate },
    end_date: { $lte: endDate }
  };

  if (userId) {
    matchStage.user_id = userId;
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avg_completeness: { $avg: '$data_quality.completeness_score' },
        total_api_requests: { $sum: '$system_metrics.api_requests_total' },
        total_transaction_volume: { $sum: '$transaction_metrics.total_volume_usd' },
        avg_user_engagement: { $avg: '$user_metrics.user_engagement_score' }
      }
    }
  ]);
};

// Static method to cleanup old analytics
analyticsSchema.statics.cleanupOld = async function(daysOld = 365) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await this.deleteMany({
    created_at: { $lt: cutoffDate }
  });

  return result.deletedCount;
};

module.exports = mongoose.model('Analytics', analyticsSchema);