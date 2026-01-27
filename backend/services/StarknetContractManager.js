const { Contract } = require('starknet');
const fs = require('fs');
const path = require('path');
const { getStarknetProvider } = require('../config/starknet');
const { getVesuConfig } = require('../config/vesu.config');


class StarknetContractManager {
  constructor(provider = null) {
    // Initialize Starknet provider
    this.provider = provider || getStarknetProvider();
    
    // Cache for contract instances
    this.poolContracts = new Map();
    this.vTokenContracts = new Map();
    
    // Cache for ABIs
    this.poolABI = null;
    this.vTokenABI = null;
    
    // Configuration
    this.config = getVesuConfig();
    
    console.log('StarknetContractManager initialized');
  }

  /**
   * Load Pool contract ABI from file
   * @returns {Array} Pool contract ABI
   */
  loadPoolABI() {
    if (this.poolABI) {
      return this.poolABI;
    }

    try {
      const abiPath = path.join(__dirname, '../abis/pool-abi.json');
      const abiContent = fs.readFileSync(abiPath, 'utf8');
      this.poolABI = JSON.parse(abiContent);
      console.log('Pool ABI loaded successfully');
      return this.poolABI;
    } catch (error) {
      throw new Error(`Failed to load Pool ABI: ${error.message}`);
    }
  }

  /**
   * Load vToken contract ABI from file
   * @returns {Array} vToken contract ABI
   */
  loadVTokenABI() {
    if (this.vTokenABI) {
      return this.vTokenABI;
    }

    try {
      const abiPath = path.join(__dirname, '../abis/vtoken-abi.json');
      const abiContent = fs.readFileSync(abiPath, 'utf8');
      this.vTokenABI = JSON.parse(abiContent);
      console.log('vToken ABI loaded successfully');
      return this.vTokenABI;
    } catch (error) {
      throw new Error(`Failed to load vToken ABI: ${error.message}`);
    }
  }

  /**
   * Initialize Pool contract instance
   * @param {string} poolAddress - Pool contract address
   * @returns {Contract} Pool contract instance
   */
  async initializePoolContract(poolAddress) {
    // Check cache first
    if (this.poolContracts.has(poolAddress)) {
      return this.poolContracts.get(poolAddress);
    }

    try {
      // Validate address format
      if (!this.isValidAddress(poolAddress)) {
        throw new Error(`Invalid pool address format: ${poolAddress}`);
      }

      // Load ABI if not already loaded
      const abi = this.loadPoolABI();

      // Create contract instance
      const contract = new Contract(abi, poolAddress, this.provider);

      // Cache the contract instance
      this.poolContracts.set(poolAddress, contract);

      console.log(`Pool contract initialized: ${poolAddress}`);
      return contract;
    } catch (error) {
      throw new Error(`Failed to initialize Pool contract at ${poolAddress}: ${error.message}`);
    }
  }

  /**
   * Initialize vToken contract instance
   * @param {string} vTokenAddress - vToken contract address
   * @returns {Contract} vToken contract instance
   */
  async initializeVTokenContract(vTokenAddress) {
    // Check cache first
    if (this.vTokenContracts.has(vTokenAddress)) {
      return this.vTokenContracts.get(vTokenAddress);
    }

    try {
      // Validate address format
      if (!this.isValidAddress(vTokenAddress)) {
        throw new Error(`Invalid vToken address format: ${vTokenAddress}`);
      }

      // Load ABI if not already loaded
      const abi = this.loadVTokenABI();

      // Create contract instance
      const contract = new Contract(abi, vTokenAddress, this.provider);

      // Cache the contract instance
      this.vTokenContracts.set(vTokenAddress, contract);

      console.log(`vToken contract initialized: ${vTokenAddress}`);
      return contract;
    } catch (error) {
      throw new Error(`Failed to initialize vToken contract at ${vTokenAddress}: ${error.message}`);
    }
  }

  /**
   * Call a Pool contract method with error handling
   * @param {string} poolAddress - Pool contract address
   * @param {string} method - Method name to call
   * @param {Array} params - Method parameters
   * @returns {Promise<any>} Method call result
   */
  async callPoolMethod(poolAddress, method, params = []) {
    try {
      // Get or initialize contract
      const contract = await this.initializePoolContract(poolAddress);

      // Validate method exists
      if (!contract[method]) {
        throw new Error(`Method '${method}' not found on Pool contract`);
      }

      // Call the method
      console.log(`Calling Pool.${method} at ${poolAddress}`);
      const result = await contract[method](...params);

      return result;
    } catch (error) {
      // Enhanced error handling
      const errorMessage = this.parseContractError(error);
      throw new Error(`Pool contract call failed (${method}): ${errorMessage}`);
    }
  }

  /**
   * Call a vToken contract method with error handling
   * @param {string} vTokenAddress - vToken contract address
   * @param {string} method - Method name to call
   * @param {Array} params - Method parameters
   * @returns {Promise<any>} Method call result
   */
  async callVTokenMethod(vTokenAddress, method, params = []) {
    try {
      // Get or initialize contract
      const contract = await this.initializeVTokenContract(vTokenAddress);

      // Validate method exists
      if (!contract[method]) {
        throw new Error(`Method '${method}' not found on vToken contract`);
      }

      // Call the method
      console.log(`Calling vToken.${method} at ${vTokenAddress}`);
      const result = await contract[method](...params);

      return result;
    } catch (error) {
      // Enhanced error handling
      const errorMessage = this.parseContractError(error);
      throw new Error(`vToken contract call failed (${method}): ${errorMessage}`);
    }
  }

  /**
   * Get Pool information
   * @param {string} poolAddress - Pool contract address
   * @returns {Promise<Object>} Pool information
   */
  async getPoolInfo(poolAddress) {
    try {
      const contract = await this.initializePoolContract(poolAddress);
      
      // Pool info would typically be fetched from multiple calls
      // This is a placeholder structure
      return {
        address: poolAddress,
        contract: contract,
        // Additional pool info would be fetched here
      };
    } catch (error) {
      throw new Error(`Failed to get pool info: ${error.message}`);
    }
  }

  /**
   * Get vToken exchange rate
   * @param {string} vTokenAddress - vToken contract address
   * @returns {Promise<string>} Exchange rate (assets per share)
   */
  async getVTokenExchangeRate(vTokenAddress) {
    try {
      // Get total assets and total supply to calculate exchange rate
      const totalAssets = await this.callVTokenMethod(vTokenAddress, 'totalAssets');
      const totalSupply = await this.callVTokenMethod(vTokenAddress, 'totalSupply');

      // Calculate exchange rate: totalAssets / totalSupply
      // If totalSupply is 0, exchange rate is 1:1
      if (totalSupply === 0n || totalSupply === '0') {
        return '1';
      }

      // Return as string to preserve precision
      return (BigInt(totalAssets) * BigInt(1e18) / BigInt(totalSupply)).toString();
    } catch (error) {
      throw new Error(`Failed to get vToken exchange rate: ${error.message}`);
    }
  }

  /**
   * Validate Starknet address format
   * @param {string} address - Address to validate
   * @returns {boolean} True if valid
   */
  isValidAddress(address) {
    // Starknet addresses are 64 hex characters (with 0x prefix)
    return /^0x[0-9a-fA-F]{1,64}$/.test(address);
  }

  /**
   * Parse contract error for better error messages
   * @param {Error} error - Original error
   * @returns {string} Parsed error message
   */
  parseContractError(error) {
    // Extract meaningful error message from Starknet errors
    if (error.message) {
      // Check for common error patterns
      if (error.message.includes('Contract not found')) {
        return 'Contract not found at the specified address';
      }
      if (error.message.includes('Entry point not found')) {
        return 'Method not found on contract';
      }
      if (error.message.includes('Invalid call data')) {
        return 'Invalid parameters provided to contract method';
      }
      if (error.message.includes('Execution failed')) {
        return 'Contract execution failed - check parameters and contract state';
      }
      
      return error.message;
    }

    return 'Unknown contract error';
  }

  /**
   * Clear contract cache
   * Useful for testing or when contracts are upgraded
   */
  clearCache() {
    this.poolContracts.clear();
    this.vTokenContracts.clear();
    console.log('Contract cache cleared');
  }

  /**
   * Get cached contract count
   * @returns {Object} Cache statistics
   */
  getCacheStats() {
    return {
      poolContracts: this.poolContracts.size,
      vTokenContracts: this.vTokenContracts.size,
      totalCached: this.poolContracts.size + this.vTokenContracts.size,
    };
  }
}

module.exports = StarknetContractManager;
