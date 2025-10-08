const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Portfolio = sequelize.define('Portfolio', {
  // Primary key
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
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

  // Portfolio overview
  total_value_usd: {
    type: DataTypes.DECIMAL(20, 2),
    defaultValue: 0,
  },
  total_value_change_24h: {
    type: DataTypes.DECIMAL(20, 2),
    defaultValue: 0,
  },
  total_value_change_percent_24h: {
    type: DataTypes.DECIMAL(10, 4),
    defaultValue: 0,
  },

  // Asset holdings (stored as JSON)
  assets: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },

  // DeFi positions summary
  defi_positions: {
    type: DataTypes.JSONB,
    defaultValue: {
      total_positions: 0,
      total_value_locked: 0,
      total_debt: 0,
      net_defi_value: 0,
      health_factor: null,
      liquidation_threshold: null
    },
  },

  // NFT holdings (stored as JSON)
  nfts: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },

  // Historical performance (stored as JSON)
  performance_history: {
    type: DataTypes.JSONB,
    defaultValue: [],
  },

  // Portfolio settings
  settings: {
    type: DataTypes.JSONB,
    defaultValue: {
      auto_refresh: true,
      refresh_interval: 300,
      hide_small_balances: true,
      small_balance_threshold: 1,
      currency: 'USD',
      include_nfts: true,
      include_defi: true
    },
  },

  // Risk metrics
  risk_metrics: {
    type: DataTypes.JSONB,
    defaultValue: {
      volatility_score: 50,
      diversification_score: 50,
      concentration_risk: 'medium',
      impermanent_loss_risk: 'none'
    },
  },

  // Sync status
  last_sync: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  sync_status: {
    type: DataTypes.ENUM('idle', 'syncing', 'completed', 'failed'),
    defaultValue: 'idle',
  },
  sync_error: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  // Model options
  indexes: [
    {
      fields: ['user_id', 'updated_at'],
    },
    {
      fields: ['total_value_usd'],
    },
    {
      fields: ['last_sync'],
    },
  ],
});

// Instance methods
Portfolio.prototype.getTopAssets = function(limit = 5) {
  if (!this.assets || !Array.isArray(this.assets)) return [];
  return this.assets
    .sort((a, b) => parseFloat(b.balance_value_usd || 0) - parseFloat(a.balance_value_usd || 0))
    .slice(0, limit);
};

Portfolio.prototype.getAssetsByNetwork = function(network) {
  if (!this.assets || !Array.isArray(this.assets)) return [];
  return this.assets.filter(asset => asset.network === network);
};

Portfolio.prototype.getDistribution = function() {
  const distribution = {
    cryptocurrencies: 0,
    defi_positions: parseFloat(this.defi_positions?.total_value_locked || 0),
    nfts: 0
  };

  // Calculate crypto value
  if (this.assets && Array.isArray(this.assets)) {
    distribution.cryptocurrencies = this.assets.reduce((sum, asset) => {
      return sum + parseFloat(asset.balance_value_usd || 0);
    }, 0);
  }

  // Calculate NFT value (simplified)
  if (this.nfts && Array.isArray(this.nfts)) {
    distribution.nfts = this.nfts.reduce((sum, nft) => {
      return sum + parseFloat(nft.floor_price || 0);
    }, 0);
  }

  return distribution;
};

// Static methods
Portfolio.getUserPortfolioSummary = async function(userId) {
  const portfolio = await this.findOne({
    where: { user_id: userId },
    order: [['updated_at', 'DESC']]
  });

  if (!portfolio) {
    return {
      total_value: 0,
      assets_count: 0,
      defi_positions: 0,
      nfts_count: 0
    };
  }

  const assets = portfolio.assets || [];
  const defiPositions = portfolio.defi_positions || {};
  const nfts = portfolio.nfts || [];

  return {
    total_value: parseFloat(portfolio.total_value_usd || 0),
    assets_count: assets.length,
    defi_positions: parseFloat(defiPositions.total_value_locked || 0),
    nfts_count: nfts.length,
    last_updated: portfolio.updated_at
  };
};

// Associations
Portfolio.associate = (models) => {
  Portfolio.belongsTo(models.User, {
    foreignKey: 'user_id',
    as: 'user'
  });
};

module.exports = Portfolio;