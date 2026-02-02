/**
 * Liquity Protocol Configuration
 * 
 * Configuration for Liquity V1 integration on Ethereum
 * Supports mainnet and testnet deployments
 */

require('dotenv').config();

const LIQUITY_CONFIG = {
  // Network configuration
  network: process.env.LIQUITY_NETWORK || 'mainnet', // 'mainnet', 'goerli', 'sepolia'
  
  // Ethereum RPC configuration
  rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/your-api-key',
  
  // Wallet configuration
  privateKey: process.env.ETHEREUM_PRIVATE_KEY,
  
  // Liquity protocol parameters
  parameters: {
    minCollateralRatio: 1.1, // 110% minimum
    safeCollateralRatio: 1.5, // 150% recommended
    conservativeCollateralRatio: 2.5, // 250% conservative
    minDebt: 2000, // Minimum 2000 LUSD
    liquidationReserve: 200, // 200 LUSD gas reservation
    borrowingFeeMin: 0.005, // 0.5% minimum
    borrowingFeeMax: 0.05, // 5% maximum
    recoveryModeThreshold: 1.5, // 150% TCR threshold
  },
  
  // Contract addresses - Ethereum Mainnet
  contracts: {
    mainnet: {
      borrowerOperations: '0x24179CD81c9e782A4096035f7eC97fB8B783e007',
      troveManager: '0xA39739EF8b0231DbFA0DcdA07d7e29faAbCf4bb2',
      stabilityPool: '0x66017D22b0f8556afDd19FC67041899Eb65a21bb',
      priceFeed: '0x4c517D4e2C851CA76d7eC94B805269Df0f2201De',
      lusdToken: '0x5f98805A4E8be255a32880FDeC7F6728C6568bA0',
      lqtyToken: '0x6DEA81C8171D0bA574754EF6F8b412F2Ed88c54D',
      lqtyStaking: '0x4f9Fbb3f1E99B56e0Fe2892e623Ed36A76Fc605d',
      hintHelpers: '0xE84251b93D9524E0d2e621Ba7dc7cb3579F997C0',
    },
    goerli: {
      // Goerli testnet addresses (if available)
      borrowerOperations: '0x...',
      troveManager: '0x...',
      stabilityPool: '0x...',
      priceFeed: '0x...',
      lusdToken: '0x...',
      lqtyToken: '0x...',
      lqtyStaking: '0x...',
      hintHelpers: '0x...',
    },
    sepolia: {
      // Sepolia testnet addresses (if available)
      borrowerOperations: '0x...',
      troveManager: '0x...',
      stabilityPool: '0x...',
      priceFeed: '0x...',
      lusdToken: '0x...',
      lqtyToken: '0x...',
      lqtyStaking: '0x...',
      hintHelpers: '0x...',
    },
  },
  
  // Monitoring configuration
  monitoring: {
    checkInterval: 60000, // Check every 60 seconds
    liquidationWarningThreshold: 1.2, // Warn at 120% CR
    criticalThreshold: 1.15, // Critical alert at 115% CR
    autoTopUpEnabled: process.env.LIQUITY_AUTO_TOPUP === 'true',
    autoTopUpThreshold: 1.3, // Auto top-up at 130% CR
    autoTopUpTarget: 1.8, // Target 180% CR after top-up
  },
  
  // Gas configuration
  gas: {
    maxGasPrice: process.env.MAX_GAS_PRICE || '100', // In gwei
    gasLimit: {
      openTrove: 500000,
      closeTrove: 300000,
      adjustTrove: 400000,
      stabilityPool: 250000,
      staking: 200000,
    },
  },
  
  // Alert configuration
  alerts: {
    enabled: process.env.LIQUITY_ALERTS_ENABLED === 'true',
    webhookUrl: process.env.LIQUITY_WEBHOOK_URL,
    emailEnabled: process.env.LIQUITY_EMAIL_ALERTS === 'true',
    emailRecipients: process.env.LIQUITY_ALERT_EMAILS?.split(',') || [],
  },
};

/**
 * Get contract addresses for current network
 */
function getContractAddresses() {
  const network = LIQUITY_CONFIG.network;
  return LIQUITY_CONFIG.contracts[network];
}

/**
 * Validate configuration
 */
function validateConfig() {
  const errors = [];
  
  if (!LIQUITY_CONFIG.rpcUrl || LIQUITY_CONFIG.rpcUrl.includes('your-api-key')) {
    errors.push('ETHEREUM_RPC_URL not configured');
  }
  
  if (!LIQUITY_CONFIG.privateKey) {
    errors.push('ETHEREUM_PRIVATE_KEY not configured');
  }
  
  const addresses = getContractAddresses();
  if (!addresses || addresses.borrowerOperations === '0x...') {
    errors.push(`Contract addresses not configured for network: ${LIQUITY_CONFIG.network}`);
  }
  
  if (errors.length > 0) {
    console.warn('⚠️  Liquity configuration warnings:', errors);
    return false;
  }
  
  return true;
}

module.exports = {
  LIQUITY_CONFIG,
  getContractAddresses,
  validateConfig,
};
