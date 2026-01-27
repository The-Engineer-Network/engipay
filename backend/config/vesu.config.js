require('dotenv').config();

/**
 * Vesu V2 Protocol Configuration
 * 
 * This file contains pool addresses, parameters, and configuration
 * for the Vesu lending protocol integration.
 * 
 * Note: Pool addresses will be updated during the research phase (Task 2)
 * after reviewing Vesu V2 documentation and deployed contracts.
 */

const NETWORKS = {
  SEPOLIA: 'sepolia',
  MAINNET: 'mainnet',
};

/**
 * Sepolia Testnet Configuration
 */
const sepoliaConfig = {
  network: NETWORKS.SEPOLIA,
  
  // Oracle configuration
  oracle: {
    address: process.env.VESU_ORACLE_ADDRESS || '0x0000000000000000000000000000000000000000', // Placeholder
    priceStalenessTolerance: 300, // 5 minutes in seconds
    cacheTTL: 60000, // 1 minute in milliseconds
  },
  
  // Lending pools configuration
  // Format: 'COLLATERAL-DEBT': { poolAddress, parameters }
  pools: {
    'ETH-USDC': {
      poolAddress: '0x0000000000000000000000000000000000000000', // Placeholder - to be updated
      collateralAsset: 'ETH',
      debtAsset: 'USDC',
      maxLTV: 0.75, // 75% maximum loan-to-value
      liquidationThreshold: 0.80, // 80% liquidation threshold
      liquidationBonus: 0.05, // 5% liquidation bonus
      isActive: true,
    },
    'STRK-USDC': {
      poolAddress: '0x0000000000000000000000000000000000000000', // Placeholder - to be updated
      collateralAsset: 'STRK',
      debtAsset: 'USDC',
      maxLTV: 0.70, // 70% maximum loan-to-value
      liquidationThreshold: 0.75, // 75% liquidation threshold
      liquidationBonus: 0.05, // 5% liquidation bonus
      isActive: true,
    },
    'ETH-STRK': {
      poolAddress: '0x0000000000000000000000000000000000000000', // Placeholder - to be updated
      collateralAsset: 'ETH',
      debtAsset: 'STRK',
      maxLTV: 0.75, // 75% maximum loan-to-value
      liquidationThreshold: 0.80, // 80% liquidation threshold
      liquidationBonus: 0.05, // 5% liquidation bonus
      isActive: false, // Disabled until verified
    },
  },
  
  // Position monitoring configuration
  monitoring: {
    interval: 60000, // 1 minute for testnet
    warningThreshold: 1.2, // Health factor warning level
    criticalThreshold: 1.05, // Health factor critical level
    liquidationThreshold: 1.0, // Health factor liquidation level
  },
  
  // Transaction configuration
  transaction: {
    maxRetries: 3,
    retryDelay: 5000, // 5 seconds
    confirmationTimeout: 300000, // 5 minutes
    gasMultiplier: 1.1, // 10% gas buffer
  },
  
  // Supported assets
  assets: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      name: 'Ethereum',
    },
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
    },
    STRK: {
      symbol: 'STRK',
      decimals: 18,
      name: 'Starknet Token',
    },
  },
};

/**
 * Mainnet Configuration
 */
const mainnetConfig = {
  network: NETWORKS.MAINNET,
  
  // Oracle configuration
  oracle: {
    address: process.env.VESU_ORACLE_ADDRESS || '0x0000000000000000000000000000000000000000', // Placeholder
    priceStalenessTolerance: 300, // 5 minutes in seconds
    cacheTTL: 30000, // 30 seconds in milliseconds (more frequent updates for mainnet)
  },
  
  // Lending pools configuration
  pools: {
    'ETH-USDC': {
      poolAddress: '0x0000000000000000000000000000000000000000', // Placeholder - to be updated
      collateralAsset: 'ETH',
      debtAsset: 'USDC',
      maxLTV: 0.75,
      liquidationThreshold: 0.80,
      liquidationBonus: 0.05,
      isActive: false, // Disabled until mainnet deployment
    },
    'STRK-USDC': {
      poolAddress: '0x0000000000000000000000000000000000000000', // Placeholder - to be updated
      collateralAsset: 'STRK',
      debtAsset: 'USDC',
      maxLTV: 0.70,
      liquidationThreshold: 0.75,
      liquidationBonus: 0.05,
      isActive: false, // Disabled until mainnet deployment
    },
  },
  
  // Position monitoring configuration
  monitoring: {
    interval: 30000, // 30 seconds for mainnet
    warningThreshold: 1.2,
    criticalThreshold: 1.05,
    liquidationThreshold: 1.0,
  },
  
  // Transaction configuration
  transaction: {
    maxRetries: 3,
    retryDelay: 10000, // 10 seconds for mainnet
    confirmationTimeout: 600000, // 10 minutes
    gasMultiplier: 1.15, // 15% gas buffer for mainnet
  },
  
  // Supported assets
  assets: {
    ETH: {
      symbol: 'ETH',
      decimals: 18,
      name: 'Ethereum',
    },
    USDC: {
      symbol: 'USDC',
      decimals: 6,
      name: 'USD Coin',
    },
    STRK: {
      symbol: 'STRK',
      decimals: 18,
      name: 'Starknet Token',
    },
  },
};

/**
 * Get configuration for current network
 */
const getVesuConfig = () => {
  const network = process.env.STARKNET_NETWORK || NETWORKS.SEPOLIA;
  
  if (network === NETWORKS.MAINNET) {
    return mainnetConfig;
  }
  
  return sepoliaConfig;
};

/**
 * Get pool configuration by key
 */
const getPoolConfig = (poolKey) => {
  const config = getVesuConfig();
  const pool = config.pools[poolKey];
  
  if (!pool) {
    throw new Error(`Pool configuration not found for: ${poolKey}`);
  }
  
  if (!pool.isActive) {
    throw new Error(`Pool is not active: ${poolKey}`);
  }
  
  return pool;
};

/**
 * Get all active pools
 */
const getActivePools = () => {
  const config = getVesuConfig();
  return Object.entries(config.pools)
    .filter(([_, pool]) => pool.isActive)
    .map(([key, pool]) => ({ key, ...pool }));
};

/**
 * Get asset configuration
 */
const getAssetConfig = (symbol) => {
  const config = getVesuConfig();
  const asset = config.assets[symbol];
  
  if (!asset) {
    throw new Error(`Asset configuration not found for: ${symbol}`);
  }
  
  return asset;
};

/**
 * Validate pool address format
 */
const isValidPoolAddress = (address) => {
  return /^0x[0-9a-fA-F]{64}$/.test(address);
};

module.exports = {
  NETWORKS,
  getVesuConfig,
  getPoolConfig,
  getActivePools,
  getAssetConfig,
  isValidPoolAddress,
  sepoliaConfig,
  mainnetConfig,
};
