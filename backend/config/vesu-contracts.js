/**
 * Vesu V2 Contract Addresses and Configuration
 * Source: https://docs.vesu.xyz/developers/contract-addresses
 * Network: StarkNet Mainnet
 */

const VESU_CONTRACTS = {
  // Core Contracts
  POOL_FACTORY: '0x3760f903a37948f97302736f89ce30290e45f441559325026842b7a6fb388c0',
  ORACLE: '0xfe4bfb1b353ba51eb34dff963017f94af5a5cf8bdf3dfc191c504657f3c05',
  MULTIPLY: '0x7964760e90baa28841ec94714151e03fbc13321797e68a874e88f27c9d58513',
  LIQUIDATE: '0x6b895ba904fb8f02ed0d74e343161de48e611e9e771be4cc2c997501dbfb418',
  MIGRATE: '0x2716dc8bf87005e2916241ac1167fb400cf69a708540c2c0c1672a654dbc5a9',
  
  // Distributors
  DEFI_SPRING_DISTRIBUTOR: '0x387f3eb1d98632fbe3440a9f1385aec9d87b6172491d3dd81f1c35a7c61048f',
  BTCFI_DISTRIBUTOR: '0x47ba31cdfc2db9bd20ab8a5b2788f877964482a8548a6e366ce56228ea22fa8',
  
  // Pools
  POOLS: {
    PRIME: '0x451fe483d5921a2919ddd81d0de6696669bccdacd859f72a4fba7656b97c3b5',
    RE7_USDC_CORE: '0x3976cac265a12609934089004df458ea29c776d77da423c96dc761d09d24124',
    RE7_USDC_PRIME: '0x2eef0c13b10b487ea5916b54c0a7f98ec43fb3048f60fdeedaf5b08f6f88aaf',
    RE7_USDC_FRONTIER: '0x5c03e7e0ccfe79c634782388eb1e6ed4e8e2a013ab0fcc055140805e46261bd',
    RE7_XBTC: '0x3a8416bf20d036df5b1cf3447630a2e1cb04685f6b0c3a70ed7fb1473548ecf',
    RE7_USDC_STABLE_CORE: '0x73702fce24aba36da1eac539bd4bae62d4d6a76747b7cdd3e016da754d7a135'
  },
  
  // Asset Addresses (StarkNet Mainnet)
  ASSETS: {
    STRK: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    USDC: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    ETH: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    WBTC: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac'
  }
};

/**
 * Amount Denomination Enum
 * Used in ModifyPositionParams
 */
const AmountDenomination = {
  ASSETS: 0,  // Actual asset amounts
  NATIVE: 1   // Native shares/debt units
};

/**
 * Pool Configuration
 */
const POOL_CONFIGS = {
  PRIME: {
    address: VESU_CONTRACTS.POOLS.PRIME,
    name: 'Prime Pool',
    description: 'Main lending pool with multiple assets',
    supportedAssets: ['STRK', 'USDC', 'ETH', 'WBTC']
  },
  RE7_USDC_CORE: {
    address: VESU_CONTRACTS.POOLS.RE7_USDC_CORE,
    name: 'Re7 USDC Core',
    description: 'USDC-focused core pool',
    supportedAssets: ['USDC', 'ETH']
  },
  RE7_USDC_PRIME: {
    address: VESU_CONTRACTS.POOLS.RE7_USDC_PRIME,
    name: 'Re7 USDC Prime',
    description: 'USDC prime pool with higher yields',
    supportedAssets: ['USDC', 'ETH']
  }
};

/**
 * Get pool address by name
 * @param {string} poolName - Pool name (e.g., 'PRIME', 'RE7_USDC_CORE')
 * @returns {string} Pool contract address
 */
function getPoolAddress(poolName) {
  const address = VESU_CONTRACTS.POOLS[poolName];
  if (!address) {
    throw new Error(`Unknown pool: ${poolName}`);
  }
  return address;
}

/**
 * Get asset address by symbol
 * @param {string} symbol - Asset symbol (e.g., 'STRK', 'USDC')
 * @returns {string} Asset contract address
 */
function getAssetAddress(symbol) {
  const address = VESU_CONTRACTS.ASSETS[symbol];
  if (!address) {
    throw new Error(`Unknown asset: ${symbol}`);
  }
  return address;
}

/**
 * Get pool configuration
 * @param {string} poolName - Pool name
 * @returns {Object} Pool configuration
 */
function getPoolConfig(poolName) {
  const config = POOL_CONFIGS[poolName];
  if (!config) {
    throw new Error(`Unknown pool configuration: ${poolName}`);
  }
  return config;
}

/**
 * Create ModifyPositionParams for supply operation
 * @param {string} collateralAsset - Collateral asset address
 * @param {string} debtAsset - Debt asset address (can be any supported asset)
 * @param {string} user - User address
 * @param {string} amount - Amount to supply (positive integer)
 * @returns {Object} ModifyPositionParams
 */
function createSupplyParams(collateralAsset, debtAsset, user, amount) {
  return {
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user: user,
    collateral: {
      denomination: AmountDenomination.ASSETS,
      value: amount
    },
    debt: {
      denomination: AmountDenomination.ASSETS,
      value: '0'
    }
  };
}

/**
 * Create ModifyPositionParams for withdraw operation
 * @param {string} collateralAsset - Collateral asset address
 * @param {string} debtAsset - Debt asset address
 * @param {string} user - User address
 * @param {string} amount - Amount to withdraw (positive integer, will be negated)
 * @returns {Object} ModifyPositionParams
 */
function createWithdrawParams(collateralAsset, debtAsset, user, amount) {
  return {
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user: user,
    collateral: {
      denomination: AmountDenomination.ASSETS,
      value: `-${amount}`
    },
    debt: {
      denomination: AmountDenomination.ASSETS,
      value: '0'
    }
  };
}

/**
 * Create ModifyPositionParams for borrow operation
 * @param {string} collateralAsset - Collateral asset address
 * @param {string} debtAsset - Debt asset address
 * @param {string} user - User address
 * @param {string} collateralAmount - Collateral amount to supply
 * @param {string} borrowAmount - Amount to borrow
 * @returns {Object} ModifyPositionParams
 */
function createBorrowParams(collateralAsset, debtAsset, user, collateralAmount, borrowAmount) {
  return {
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user: user,
    collateral: {
      denomination: AmountDenomination.ASSETS,
      value: collateralAmount
    },
    debt: {
      denomination: AmountDenomination.ASSETS,
      value: borrowAmount
    }
  };
}

/**
 * Create ModifyPositionParams for repay operation
 * @param {string} collateralAsset - Collateral asset address
 * @param {string} debtAsset - Debt asset address
 * @param {string} user - User address
 * @param {string} repayAmount - Amount to repay (positive integer, will be negated)
 * @returns {Object} ModifyPositionParams
 */
function createRepayParams(collateralAsset, debtAsset, user, repayAmount) {
  return {
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user: user,
    collateral: {
      denomination: AmountDenomination.ASSETS,
      value: '0'
    },
    debt: {
      denomination: AmountDenomination.ASSETS,
      value: `-${repayAmount}`
    }
  };
}

/**
 * Create LiquidatePositionParams
 * @param {string} collateralAsset - Collateral asset address
 * @param {string} debtAsset - Debt asset address
 * @param {string} user - User address to liquidate
 * @param {string} minCollateralToReceive - Minimum collateral to receive
 * @param {string} debtToRepay - Amount of debt to repay
 * @returns {Object} LiquidatePositionParams
 */
function createLiquidateParams(collateralAsset, debtAsset, user, minCollateralToReceive, debtToRepay) {
  return {
    collateral_asset: collateralAsset,
    debt_asset: debtAsset,
    user: user,
    min_collateral_to_receive: minCollateralToReceive,
    debt_to_repay: debtToRepay
  };
}

module.exports = {
  VESU_CONTRACTS,
  AmountDenomination,
  POOL_CONFIGS,
  getPoolAddress,
  getAssetAddress,
  getPoolConfig,
  createSupplyParams,
  createWithdrawParams,
  createBorrowParams,
  createRepayParams,
  createLiquidateParams
};
