const { ethers } = require('ethers');
const axios = require('axios');
require('dotenv').config();

/**
 * Blockchain Service - Backend Dev 1
 * Handles RPC connections, transaction broadcasting, and balance fetching
 */

class BlockchainService {
  constructor() {
    // Initialize providers
    this.providers = {
      ethereum: null,
      starknet: null,
      bitcoin: null
    };

    // Initialize RPC connections
    this.initializeProviders();
  }

  /**
   * Initialize blockchain RPC providers
   */
  initializeProviders() {
    try {
      // Ethereum Provider (Infura/Alchemy)
      const ethereumRPC = process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo';
      this.providers.ethereum = new ethers.JsonRpcProvider(ethereumRPC);
      console.log('✅ Ethereum RPC connected');

      // StarkNet Provider
      const starknetRPC = process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io';
      this.providers.starknet = starknetRPC;
      console.log('✅ StarkNet RPC configured');

      // Bitcoin Provider (using blockchain.info API)
      const bitcoinRPC = process.env.BITCOIN_RPC_URL || 'https://blockchain.info';
      this.providers.bitcoin = bitcoinRPC;
      console.log('✅ Bitcoin RPC configured');

    } catch (error) {
      console.error('❌ Error initializing blockchain providers:', error);
      throw error;
    }
  }

  /**
   * Get real portfolio balances across all chains
   * @param {string} walletAddress - User's wallet address
   * @param {string} network - Network to query (ethereum, starknet, bitcoin)
   * @returns {Promise<Object>} Portfolio balances
   */
  async getPortfolioBalances(walletAddress, network = 'all') {
    try {
      const balances = {
        total_value_usd: 0,
        assets: [],
        last_updated: new Date().toISOString()
      };

      // Fetch balances based on network
      if (network === 'all' || network === 'ethereum') {
        const ethBalances = await this.getEthereumBalances(walletAddress);
        balances.assets.push(...ethBalances);
      }

      if (network === 'all' || network === 'starknet') {
        const starknetBalances = await this.getStarkNetBalances(walletAddress);
        balances.assets.push(...starknetBalances);
      }

      if (network === 'all' || network === 'bitcoin') {
        const btcBalance = await this.getBitcoinBalance(walletAddress);
        if (btcBalance) {
          balances.assets.push(btcBalance);
        }
      }

      // Calculate total value
      balances.total_value_usd = balances.assets.reduce((sum, asset) => sum + asset.value_usd, 0);

      return balances;
    } catch (error) {
      console.error('Error fetching portfolio balances:', error);
      throw error;
    }
  }

  /**
   * Get Ethereum and ERC20 token balances
   * @param {string} address - Ethereum address
   * @returns {Promise<Array>} Array of asset balances
   */
  async getEthereumBalances(address) {
    try {
      const assets = [];

      // Get ETH balance
      const ethBalance = await this.providers.ethereum.getBalance(address);
      const ethAmount = ethers.formatEther(ethBalance);
      
      // Get ETH price
      const ethPrice = await this.getAssetPrice('ethereum');
      
      assets.push({
        symbol: 'ETH',
        name: 'Ethereum',
        balance: ethAmount,
        value_usd: parseFloat(ethAmount) * ethPrice,
        chain: 'ethereum',
        contract_address: '0x0000000000000000000000000000000000000000',
        decimals: 18,
        price_usd: ethPrice
      });

      // Get ERC20 token balances (USDC, USDT, etc.)
      const tokens = [
        {
          symbol: 'USDC',
          name: 'USD Coin',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          decimals: 6
        },
        {
          symbol: 'USDT',
          name: 'Tether USD',
          address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
          decimals: 6
        }
      ];

      for (const token of tokens) {
        try {
          const balance = await this.getERC20Balance(address, token.address, token.decimals);
          if (parseFloat(balance) > 0) {
            const price = await this.getAssetPrice(token.symbol.toLowerCase());
            assets.push({
              symbol: token.symbol,
              name: token.name,
              balance: balance,
              value_usd: parseFloat(balance) * price,
              chain: 'ethereum',
              contract_address: token.address,
              decimals: token.decimals,
              price_usd: price
            });
          }
        } catch (error) {
          console.error(`Error fetching ${token.symbol} balance:`, error.message);
        }
      }

      return assets;
    } catch (error) {
      console.error('Error fetching Ethereum balances:', error);
      return [];
    }
  }

  /**
   * Get ERC20 token balance
   * @param {string} walletAddress - Wallet address
   * @param {string} tokenAddress - Token contract address
   * @param {number} decimals - Token decimals
   * @returns {Promise<string>} Token balance
   */
  async getERC20Balance(walletAddress, tokenAddress, decimals) {
    try {
      const abi = ['function balanceOf(address) view returns (uint256)'];
      const contract = new ethers.Contract(tokenAddress, abi, this.providers.ethereum);
      const balance = await contract.balanceOf(walletAddress);
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      console.error('Error fetching ERC20 balance:', error);
      return '0';
    }
  }

  /**
   * Get StarkNet balances
   * @param {string} address - StarkNet address
   * @returns {Promise<Array>} Array of asset balances
   */
  async getStarkNetBalances(address) {
    try {
      const assets = [];

      // StarkNet RPC call to get STRK balance
      const response = await axios.post(this.providers.starknet, {
        jsonrpc: '2.0',
        method: 'starknet_getBalance',
        params: [address],
        id: 1
      });

      if (response.data && response.data.result) {
        const balance = response.data.result;
        const strkAmount = (parseInt(balance, 16) / 1e18).toFixed(6);
        const strkPrice = await this.getAssetPrice('starknet');

        assets.push({
          symbol: 'STRK',
          name: 'StarkNet',
          balance: strkAmount,
          value_usd: parseFloat(strkAmount) * strkPrice,
          chain: 'starknet',
          contract_address: '0x0',
          decimals: 18,
          price_usd: strkPrice
        });
      }

      return assets;
    } catch (error) {
      console.error('Error fetching StarkNet balances:', error);
      return [];
    }
  }

  /**
   * Get Bitcoin balance
   * @param {string} address - Bitcoin address
   * @returns {Promise<Object|null>} Bitcoin balance
   */
  async getBitcoinBalance(address) {
    try {
      // Use blockchain.info API
      const response = await axios.get(`${this.providers.bitcoin}/balance?active=${address}`);
      
      if (response.data && response.data[address]) {
        const satoshis = response.data[address].final_balance;
        const btcAmount = (satoshis / 1e8).toFixed(8);
        const btcPrice = await this.getAssetPrice('bitcoin');

        return {
          symbol: 'BTC',
          name: 'Bitcoin',
          balance: btcAmount,
          value_usd: parseFloat(btcAmount) * btcPrice,
          chain: 'bitcoin',
          contract_address: null,
          decimals: 8,
          price_usd: btcPrice
        };
      }

      return null;
    } catch (error) {
      console.error('Error fetching Bitcoin balance:', error);
      return null;
    }
  }

  /**
   * Get asset price from CoinGecko
   * @param {string} assetId - CoinGecko asset ID
   * @returns {Promise<number>} Asset price in USD
   */
  async getAssetPrice(assetId) {
    try {
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd`
      );
      return response.data[assetId]?.usd || 0;
    } catch (error) {
      console.error(`Error fetching price for ${assetId}:`, error.message);
      return 0;
    }
  }

  /**
   * Broadcast transaction to blockchain
   * @param {Object} txData - Transaction data
   * @returns {Promise<Object>} Transaction result
   */
  async broadcastTransaction(txData) {
    try {
      const { network, signedTransaction, from, to, amount, asset } = txData;

      let txHash = null;
      let status = 'pending';

      switch (network) {
        case 'ethereum':
          txHash = await this.broadcastEthereumTransaction(signedTransaction);
          break;
        
        case 'starknet':
          txHash = await this.broadcastStarkNetTransaction(signedTransaction);
          break;
        
        case 'bitcoin':
          txHash = await this.broadcastBitcoinTransaction(signedTransaction);
          break;
        
        default:
          throw new Error(`Unsupported network: ${network}`);
      }

      return {
        tx_hash: txHash,
        status: status,
        network: network,
        from: from,
        to: to,
        amount: amount,
        asset: asset,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error broadcasting transaction:', error);
      throw error;
    }
  }

  /**
   * Broadcast Ethereum transaction
   * @param {string} signedTx - Signed transaction hex
   * @returns {Promise<string>} Transaction hash
   */
  async broadcastEthereumTransaction(signedTx) {
    try {
      const tx = await this.providers.ethereum.broadcastTransaction(signedTx);
      return tx.hash;
    } catch (error) {
      console.error('Error broadcasting Ethereum transaction:', error);
      throw error;
    }
  }

  /**
   * Broadcast StarkNet transaction
   * @param {Object} signedTx - Signed transaction
   * @returns {Promise<string>} Transaction hash
   */
  async broadcastStarkNetTransaction(signedTx) {
    try {
      const response = await axios.post(this.providers.starknet, {
        jsonrpc: '2.0',
        method: 'starknet_addInvokeTransaction',
        params: [signedTx],
        id: 1
      });

      if (response.data && response.data.result) {
        return response.data.result.transaction_hash;
      }

      throw new Error('Failed to broadcast StarkNet transaction');
    } catch (error) {
      console.error('Error broadcasting StarkNet transaction:', error);
      throw error;
    }
  }

  /**
   * Broadcast Bitcoin transaction
   * @param {string} signedTx - Signed transaction hex
   * @returns {Promise<string>} Transaction hash
   */
  async broadcastBitcoinTransaction(signedTx) {
    try {
      const response = await axios.post(`${this.providers.bitcoin}/pushtx`, {
        tx: signedTx
      });

      if (response.data) {
        return response.data;
      }

      throw new Error('Failed to broadcast Bitcoin transaction');
    } catch (error) {
      console.error('Error broadcasting Bitcoin transaction:', error);
      throw error;
    }
  }

  /**
   * Get transaction confirmation status
   * @param {string} txHash - Transaction hash
   * @param {string} network - Network (ethereum, starknet, bitcoin)
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(txHash, network) {
    try {
      switch (network) {
        case 'ethereum':
          return await this.getEthereumTransactionStatus(txHash);
        
        case 'starknet':
          return await this.getStarkNetTransactionStatus(txHash);
        
        case 'bitcoin':
          return await this.getBitcoinTransactionStatus(txHash);
        
        default:
          throw new Error(`Unsupported network: ${network}`);
      }
    } catch (error) {
      console.error('Error getting transaction status:', error);
      throw error;
    }
  }

  /**
   * Get Ethereum transaction status
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>} Transaction status
   */
  async getEthereumTransactionStatus(txHash) {
    try {
      const receipt = await this.providers.ethereum.getTransactionReceipt(txHash);
      
      if (!receipt) {
        return {
          status: 'pending',
          confirmations: 0,
          block_number: null,
          gas_used: null
        };
      }

      const currentBlock = await this.providers.ethereum.getBlockNumber();
      const confirmations = currentBlock - receipt.blockNumber;

      return {
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        confirmations: confirmations,
        block_number: receipt.blockNumber,
        gas_used: receipt.gasUsed.toString(),
        gas_price: receipt.gasPrice ? receipt.gasPrice.toString() : null,
        transaction_fee: receipt.gasUsed && receipt.gasPrice 
          ? ethers.formatEther(receipt.gasUsed * receipt.gasPrice)
          : null
      };
    } catch (error) {
      console.error('Error getting Ethereum transaction status:', error);
      throw error;
    }
  }

  /**
   * Get StarkNet transaction status
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>} Transaction status
   */
  async getStarkNetTransactionStatus(txHash) {
    try {
      const response = await axios.post(this.providers.starknet, {
        jsonrpc: '2.0',
        method: 'starknet_getTransactionReceipt',
        params: [txHash],
        id: 1
      });

      if (response.data && response.data.result) {
        const receipt = response.data.result;
        
        return {
          status: receipt.status || 'pending',
          confirmations: receipt.block_number ? 1 : 0,
          block_number: receipt.block_number || null,
          gas_used: receipt.actual_fee || null
        };
      }

      return {
        status: 'pending',
        confirmations: 0,
        block_number: null,
        gas_used: null
      };
    } catch (error) {
      console.error('Error getting StarkNet transaction status:', error);
      return {
        status: 'pending',
        confirmations: 0,
        block_number: null,
        gas_used: null
      };
    }
  }

  /**
   * Get Bitcoin transaction status
   * @param {string} txHash - Transaction hash
   * @returns {Promise<Object>} Transaction status
   */
  async getBitcoinTransactionStatus(txHash) {
    try {
      const response = await axios.get(`${this.providers.bitcoin}/rawtx/${txHash}`);
      
      if (response.data) {
        const tx = response.data;
        
        return {
          status: tx.block_height ? 'confirmed' : 'pending',
          confirmations: tx.block_height ? 6 : 0, // Simplified
          block_number: tx.block_height || null,
          gas_used: tx.fee || null
        };
      }

      return {
        status: 'pending',
        confirmations: 0,
        block_number: null,
        gas_used: null
      };
    } catch (error) {
      console.error('Error getting Bitcoin transaction status:', error);
      return {
        status: 'pending',
        confirmations: 0,
        block_number: null,
        gas_used: null
      };
    }
  }

  /**
   * Estimate gas for Ethereum transaction
   * @param {Object} txData - Transaction data
   * @returns {Promise<Object>} Gas estimation
   */
  async estimateGas(txData) {
    try {
      const { from, to, value, data, network } = txData;

      if (network === 'ethereum') {
        const gasLimit = await this.providers.ethereum.estimateGas({
          from,
          to,
          value: value ? ethers.parseEther(value) : undefined,
          data: data || '0x'
        });

        const feeData = await this.providers.ethereum.getFeeData();

        return {
          gas_limit: gasLimit.toString(),
          gas_price: feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, 'gwei') : null,
          max_fee: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : null,
          max_priority_fee: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') : null,
          estimated_cost_eth: feeData.gasPrice 
            ? ethers.formatEther(gasLimit * feeData.gasPrice)
            : null
        };
      }

      return null;
    } catch (error) {
      console.error('Error estimating gas:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new BlockchainService();
