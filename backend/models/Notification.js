const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Notification identification
  notification_id: {
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

  // Notification type
  type: {
    type: String,
    required: true,
    enum: [
      'transaction_completed',     // Transaction completed
      'transaction_failed',        // Transaction failed
      'payment_received',          // Payment received
      'payment_request',           // New payment request
      'swap_completed',           // Swap completed
      'swap_failed',              // Swap failed
      'reward_available',         // Rewards available to claim
      'position_liquidation',     // Position at risk of liquidation
      'health_factor_warning',    // Health factor warning
      'apy_change',              // APY changed significantly
      'price_alert',             // Price alert triggered
      'security_alert',          // Security-related alert
      'system_maintenance',      // System maintenance notice
      'new_feature',             // New feature announcement
      'marketing',               // Marketing/promotional
      'kyc_update',              // KYC status update
      'account_verification',    // Account verification needed
      'other'
    ],
    index: true
  },

  // Notification priority
  priority: {
    type: String,
    required: true,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  },

  // Notification status
  status: {
    type: String,
    required: true,
    enum: [
      'unread',     // Not yet read by user
      'read',       // Read by user
      'archived',   // Archived by user
      'deleted'     // Deleted by user
    ],
    default: 'unread',
    index: true
  },

  // Notification content
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },

  // Rich content (optional)
  description: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  image_url: {
    type: String,
    trim: true
  },
  action_url: {
    type: String,
    trim: true
  },
  action_text: {
    type: String,
    trim: true,
    maxlength: 50
  },

  // Related entities
  related_entities: {
    transaction_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction'
    },
    position_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeFiPosition'
    },
    farm_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'YieldFarm'
    },
    reward_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reward'
    },
    payment_request_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentRequest'
    },
    wallet_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Wallet'
    }
  },

  // Delivery channels
  channels: {
    in_app: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: false
    },
    push: {
      type: Boolean,
      default: false
    },
    sms: {
      type: Boolean,
      default: false
    }
  },

  // Delivery status
  delivery_status: {
    in_app: {
      type: String,
      enum: ['pending', 'delivered', 'failed'],
      default: 'pending'
    },
    email: {
      sent_at: Date,
      delivered_at: Date,
      opened_at: Date,
      clicked_at: Date,
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained']
      }
    },
    push: {
      sent_at: Date,
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed']
      }
    },
    sms: {
      sent_at: Date,
      status: {
        type: String,
        enum: ['pending', 'sent', 'delivered', 'failed']
      }
    }
  },

  // Scheduling
  scheduled_at: {
    type: Date
  },
  expires_at: {
    type: Date
  },

  // User interaction
  read_at: {
    type: Date
  },
  archived_at: {
    type: Date
  },
  deleted_at: {
    type: Date
  },

  // Click tracking
  clicks: {
    count: {
      type: Number,
      default: 0,
      min: 0
    },
    last_clicked_at: Date,
    click_data: [{
      timestamp: Date,
      user_agent: String,
      ip_address: String
    }]
  },

  // Metadata
  tags: [{
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 20
  }],
  category: {
    type: String,
    enum: [
      'transaction',
      'defi',
      'security',
      'system',
      'marketing',
      'account',
      'other'
    ],
    default: 'other'
  },
  source: {
    type: String,
    enum: [
      'system',
      'user_action',
      'blockchain_event',
      'scheduled',
      'manual',
      'integration'
    ],
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
  }
});

// Indexes for performance
notificationSchema.index({ user_id: 1, status: 1, created_at: -1 });
notificationSchema.index({ user_id: 1, type: 1, created_at: -1 });
notificationSchema.index({ priority: 1, status: 1 });
notificationSchema.index({ scheduled_at: 1 });
notificationSchema.index({ expires_at: 1 });
notificationSchema.index({ 'delivery_status.email.status': 1 });

// Pre-save middleware
notificationSchema.pre('save', function(next) {
  this.updated_at = new Date();

  // Set timestamps based on status changes
  if (this.isModified('status')) {
    const now = new Date();
    switch (this.status) {
      case 'read':
        if (!this.read_at) this.read_at = now;
        break;
      case 'archived':
        if (!this.archived_at) this.archived_at = now;
        break;
      case 'deleted':
        if (!this.deleted_at) this.deleted_at = now;
        break;
    }
  }

  next();
});

// Virtual for whether notification is expired
notificationSchema.virtual('is_expired').get(function() {
  return this.expires_at && new Date() > this.expires_at;
});

// Virtual for whether notification is actionable
notificationSchema.virtual('is_actionable').get(function() {
  return this.action_url && this.action_text;
});

// Method to mark as read
notificationSchema.methods.markAsRead = function() {
  if (this.status === 'unread') {
    this.status = 'read';
    this.read_at = new Date();
    return this.save();
  }
  return this;
};

// Method to archive notification
notificationSchema.methods.archive = function() {
  if (this.status !== 'deleted') {
    this.status = 'archived';
    this.archived_at = new Date();
    return this.save();
  }
  throw new Error('Cannot archive a deleted notification');
};

// Method to delete notification
notificationSchema.methods.delete = function() {
  this.status = 'deleted';
  this.deleted_at = new Date();
  return this.save();
};

// Method to track click
notificationSchema.methods.trackClick = function(userAgent, ipAddress) {
  this.clicks.count += 1;
  this.clicks.last_clicked_at = new Date();
  this.clicks.click_data.push({
    timestamp: new Date(),
    user_agent: userAgent,
    ip_address: ipAddress
  });

  // Update email click tracking if applicable
  if (this.delivery_status.email.status) {
    this.delivery_status.email.clicked_at = new Date();
    this.delivery_status.email.status = 'clicked';
  }

  return this.save();
};

// Static method to get user notifications
notificationSchema.statics.getUserNotifications = async function(userId, options = {}) {
  const {
    status = ['unread', 'read'],
    type,
    priority,
    limit = 20,
    offset = 0,
    includeExpired = false
  } = options;

  const query = { user_id: userId, status: { $in: status } };

  if (type) query.type = type;
  if (priority) query.priority = priority;
  if (!includeExpired) {
    query.$or = [
      { expires_at: { $exists: false } },
      { expires_at: { $gt: new Date() } }
    ];
  }

  return this.find(query)
    .sort({ created_at: -1 })
    .limit(limit)
    .skip(offset);
};

// Static method to get unread count
notificationSchema.statics.getUnreadCount = async function(userId) {
  return this.countDocuments({
    user_id: userId,
    status: 'unread',
    $or: [
      { expires_at: { $exists: false } },
      { expires_at: { $gt: new Date() } }
    ]
  });
};

// Static method to mark all as read
notificationSchema.statics.markAllAsRead = async function(userId) {
  const result = await this.updateMany(
    {
      user_id: userId,
      status: 'unread'
    },
    {
      status: 'read',
      read_at: new Date(),
      updated_at: new Date()
    }
  );
  return result.modifiedCount;
};

// Static method to cleanup old notifications
notificationSchema.statics.cleanupOld = async function(daysOld = 90) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const result = await this.deleteMany({
    created_at: { $lt: cutoffDate },
    status: { $in: ['read', 'archived'] }
  });

  return result.deletedCount;
};

module.exports = mongoose.model('Notification', notificationSchema);