/**
 * Tongo Contract Configuration
 * Official contract addresses from: https://docs.tongo.cash/protocol/contracts.html
 * 
 * Tongo wraps ERC20 tokens with ElGamal encryption for private transactions
 */

// Tongo Class Hash (for deployment)
const TONGO_CLASS_HASH = '0x00582609087e5aeb75dc25284cf954e2cee6974568d1b5636052a9d36eec672a';

// Sepolia Testnet Contracts
const SEPOLIA_CONTRACTS = {
  STRK: {
    erc20: '0x4718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    tongo: '0x408163bfcfc2d76f34b444cb55e09dace5905cf84c0884e4637c2c0f06ab6ed',
    rate: '50000000000000000', // ERC20_amount = Tongo_amount * rate
    symbol: 'STRK',
    name: 'StarkNet Token',
    decimals: 18
  },
  ETH: {
    erc20: '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    tongo: '0x2cf0dc1d9e8c7731353dd15e6f2f22140120ef2d27116b982fa4fed87f6fef5',
    rate: '3000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18
  },
  USDC: {
    erc20: '0x53b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080',
    tongo: '0x2caae365e67921979a4e5c16dd70eaa5776cfc6a9592bcb903d91933aaf2552',
    rate: '10000',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6
  }
};

// Mainnet Contracts
const MAINNET_CONTRACTS = {
  STRK: {
    erc20: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
    tongo: '0x3a542d7eb73b3e33a2c54e9827ec17a6365e289ec35ccc94dde97950d9db498',
    rate: '50000000000000000',
    symbol: 'STRK',
    name: 'StarkNet Token',
    decimals: 18
  },
  ETH: {
    erc20: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
    tongo: '0x276e11a5428f6de18a38b7abc1d60abc75ce20aa3a925e20a393fcec9104f89',
    rate: '3000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18
  },
  wBTC: {
    erc20: '0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac',
    tongo: '0x6d82c8c467eac77f880a1d5a090e0e0094a557bf67d74b98ba1881200750e27',
    rate: '10',
    symbol: 'wBTC',
    name: 'Wrapped Bitcoin',
    decimals: 8
  },
  'USDC.e': {
    erc20: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    tongo: '0x72098b84989a45cc00697431dfba300f1f5d144ae916e98287418af4e548d96',
    rate: '10000',
    symbol: 'USDC.e',
    name: 'USD Coin (Bridged)',
    decimals: 6
  },
  USDC: {
    erc20: '0x033068F6539f8e6e6b131e6B2B814e6c34A5224bC66947c47DaB9dFeE93b35fb',
    tongo: '0x026f79017c3c382148832c6ae50c22502e66f7a2f81ccbdb9e1377af31859d3a',
    rate: '10000',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6
  },
  USDT: {
    erc20: '0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8',
    tongo: '0x659c62ba8bc3ac92ace36ba190b350451d0c767aa973dd63b042b59cc065da0',
    rate: '10000',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6
  },
  DAI: {
    erc20: '0x00da114221cb83fa859dbdb4c44beeaa0bb37c7537ad5ae66fe5e0efd20e6eb3',
    tongo: '0x511741b1ad1777b4ad59fbff49d64b8eb188e2aeb4fc72438278a589d8a10d8',
    rate: '10000000000000000',
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18
  }
};

/**
 * Get Tongo contracts for the current network
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {Object} Contract configuration
 */
function getTongoContracts(network = 'sepolia') {
  return network === 'mainnet' ? MAINNET_CONTRACTS : SEPOLIA_CONTRACTS;
}

/**
 * Get Tongo contract address for a specific token
 * @param {string} symbol - Token symbol (STRK, ETH, USDC, etc.)
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {string} Tongo contract address
 */
function getTongoContractAddress(symbol, network = 'sepolia') {
  const contracts = getTongoContracts(network);
  const token = contracts[symbol.toUpperCase()];
  
  if (!token) {
    throw new Error(`Tongo contract not found for token: ${symbol}`);
  }
  
  return token.tongo;
}

/**
 * Get ERC20 contract address for a specific token
 * @param {string} symbol - Token symbol (STRK, ETH, USDC, etc.)
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {string} ERC20 contract address
 */
function getERC20ContractAddress(symbol, network = 'sepolia') {
  const contracts = getTongoContracts(network);
  const token = contracts[symbol.toUpperCase()];
  
  if (!token) {
    throw new Error(`ERC20 contract not found for token: ${symbol}`);
  }
  
  return token.erc20;
}

/**
 * Get conversion rate for a specific token
 * @param {string} symbol - Token symbol (STRK, ETH, USDC, etc.)
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {string} Conversion rate
 */
function getConversionRate(symbol, network = 'sepolia') {
  const contracts = getTongoContracts(network);
  const token = contracts[symbol.toUpperCase()];
  
  if (!token) {
    throw new Error(`Conversion rate not found for token: ${symbol}`);
  }
  
  return token.rate;
}

/**
 * Get all supported tokens for a network
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {Array} List of supported tokens
 */
function getSupportedTokens(network = 'sepolia') {
  const contracts = getTongoContracts(network);
  
  return Object.keys(contracts).map(symbol => ({
    symbol: contracts[symbol].symbol,
    name: contracts[symbol].name,
    decimals: contracts[symbol].decimals,
    erc20Address: contracts[symbol].erc20,
    tongoAddress: contracts[symbol].tongo,
    rate: contracts[symbol].rate
  }));
}

/**
 * Convert ERC20 amount to Tongo amount
 * @param {string} erc20Amount - Amount in ERC20 tokens
 * @param {string} symbol - Token symbol
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {string} Amount in Tongo tokens
 */
function erc20ToTongo(erc20Amount, symbol, network = 'sepolia') {
  const rate = BigInt(getConversionRate(symbol, network));
  const amount = BigInt(erc20Amount);
  
  return (amount / rate).toString();
}

/**
 * Convert Tongo amount to ERC20 amount
 * @param {string} tongoAmount - Amount in Tongo tokens
 * @param {string} symbol - Token symbol
 * @param {string} network - 'mainnet' or 'sepolia'
 * @returns {string} Amount in ERC20 tokens
 */
function tongoToERC20(tongoAmount, symbol, network = 'sepolia') {
  const rate = BigInt(getConversionRate(symbol, network));
  const amount = BigInt(tongoAmount);
  
  return (amount * rate).toString();
}

module.exports = {
  TONGO_CLASS_HASH,
  SEPOLIA_CONTRACTS,
  MAINNET_CONTRACTS,
  getTongoContracts,
  getTongoContractAddress,
  getERC20ContractAddress,
  getConversionRate,
  getSupportedTokens,
  erc20ToTongo,
  tongoToERC20
};
