/**
 * Liquity Trove Model
 * 
 * Represents a Liquity Trove (borrowing position) in the database
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const LiquityTrove = sequelize.define('LiquityTrove', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  
  // User reference
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id',
    },
  },
  
  // Ethereum address that owns the Trove
  ownerAddress: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      is: /^0x[a-fA-F0-9]{40}$/,
    },
  },
  
  // Trove status
  status: {
    type: DataTypes.ENUM('active', 'closed', 'liquidated'),
    defaultValue: 'active',
    allowNull: false,
  },
  
  // Collateral (ETH)
  collateral: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'ETH collateral amount',
  },
  
  // Debt (LUSD)
  debt: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'LUSD debt amount',
  },
  
  // Collateral ratio
  collateralRatio: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    comment: 'Current collateral ratio (e.g., 1.5000 = 150%)',
  },
  
  // ETH price at last update
  ethPrice: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: true,
    comment: 'ETH price in USD at last update',
  },
  
  // Liquidation price
  liquidationPrice: {
    type: DataTypes.DECIMAL(18, 8),
    allowNull: true,
    comment: 'ETH price at which Trove would be liquidated',
  },
  
  // Opening transaction
  openTxHash: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      is: /^0x[a-fA-F0-9]{64}$/,
    },
  },
  
  openedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  // Closing transaction
  closeTxHash: {
    type: DataTypes.STRING,
    allowNull: true,
    validate: {
      is: /^0x[a-fA-F0-9]{64}$/,
    },
  },
  
  closedAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  // Borrowing fee paid
  borrowingFeePaid: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 0,
    comment: 'Total borrowing fees paid in LUSD',
  },
  
  // Liquidation reserve
  liquidationReserve: {
    type: DataTypes.DECIMAL(36, 18),
    allowNull: false,
    defaultValue: 200,
    comment: 'Liquidation reserve (200 LUSD)',
  },
  
  // Health metrics
  healthScore: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'Health score 0-100',
  },
  
  riskLevel: {
    type: DataTypes.ENUM('safe', 'moderate', 'warning', 'critical', 'liquidation'),
    defaultValue: 'safe',
  },
  
  // Monitoring
  lastMonitoredAt: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  
  alertsSent: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of alerts sent for this Trove',
  },
  
  // Metadata
  metadata: {
    type: DataTypes.JSONB,
    defaultValue: {},
    comment: 'Additional metadata and history',
  },
}, {
  tableName: 'liquity_troves',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['ownerAddress'], unique: true },
    { fields: ['status'] },
    { fields: ['riskLevel'] },
    { fields: ['collateralRatio'] },
    { fields: ['lastMonitoredAt'] },
  ],
});

// Instance methods
LiquityTrove.prototype.calculateHealthScore = function() {
  if (!this.collateralRatio) return 0;
  
  const cr = parseFloat(this.collateralRatio);
  
  // Health score based on collateral ratio
  if (cr >= 2.5) return 100; // Conservative
  if (cr >= 2.0) return 90;
  if (cr >= 1.5) return 75; // Safe
  if (cr >= 1.3) return 50; // Moderate
  if (cr >= 1.2) return 25; // Warning
  if (cr >= 1.15) return 10; // Critical
  return 0; // Liquidation imminent
};

LiquityTrove.prototype.updateRiskLevel = function() {
  if (!this.collateralRatio) {
    this.riskLevel = 'safe';
    return;
  }
  
  const cr = parseFloat(this.collateralRatio);
  
  if (cr >= 2.5) this.riskLevel = 'safe';
  else if (cr >= 1.5) this.riskLevel = 'safe';
  else if (cr >= 1.3) this.riskLevel = 'moderate';
  else if (cr >= 1.2) this.riskLevel = 'warning';
  else if (cr >= 1.15) this.riskLevel = 'critical';
  else this.riskLevel = 'liquidation';
};

LiquityTrove.prototype.calculateLiquidationPrice = function() {
  if (!this.collateral || parseFloat(this.collateral) === 0) return 0;
  
  const debt = parseFloat(this.debt);
  const collateral = parseFloat(this.collateral);
  
  // Liquidation price = (Debt * 1.1) / Collateral
  return (debt * 1.1) / collateral;
};

module.exports = LiquityTrove;
