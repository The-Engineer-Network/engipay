const { RpcProvider, constants } = require('starknet');
require('dotenv').config();

/**
 * Starknet RPC Provider Configuration
 * Supports both Sepolia testnet and Mainnet
 */

const getStarknetProvider = () => {
  const network = process.env.STARKNET_NETWORK || 'sepolia';
  // Use Lava RPC as primary provider for better reliability
  const rpcUrl = process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build';

  // Create RPC provider
  const provider = new RpcProvider({
    nodeUrl: rpcUrl,
  });

  console.log(`Starknet provider initialized for ${network} network using ${rpcUrl}`);
  return provider;
};

/**
 * Get network chain ID
 */
const getChainId = () => {
  const network = process.env.STARKNET_NETWORK || 'sepolia';
  
  if (network === 'mainnet') {
    return constants.StarknetChainId.SN_MAIN;
  } else if (network === 'sepolia') {
    return constants.StarknetChainId.SN_SEPOLIA;
  }
  
  throw new Error(`Unsupported network: ${network}`);
};

/**
 * Validate provider connection
 */
const validateConnection = async (provider) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    console.log(`Successfully connected to Starknet. Current block: ${blockNumber}`);
    return true;
  } catch (error) {
    console.error('Failed to connect to Starknet:', error.message);
    return false;
  }
};

module.exports = {
  getStarknetProvider,
  getChainId,
  validateConnection,
};
