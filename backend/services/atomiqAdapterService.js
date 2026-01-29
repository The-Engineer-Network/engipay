const { Contract, RpcProvider, Account, CallData, uint256 } = require('starknet');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * AtomiqAdapter Service - Smart Contract Integration
 * Handles interaction with the AtomiqAdapter smart contract on StarkNet
 */

class AtomiqAdapterService {
  constructor() {
    this.provider = null;
    this.account = null;
    this.contract = null;
    this.initialized = false;
  }

  /**
   * Initialize the service with StarkNet connection
   */
  async initialize() {
    try {
      if (this.initialized) {
        return;
      }

      console.log('Initializing AtomiqAdapter service...');

      // Initialize provider
      this.provider = new RpcProvider({
        nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io'
      });

      // Initialize account (for contract interactions)
      const privateKey = process.env.STARKNET_PRIVATE_KEY;
      const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS;
      
      if (privateKey && accountAddress) {
        this.account = new Account(this.provider, accountAddress, privateKey);
        console.log('✅ StarkNet account initialized');
      } else {
        console.warn('⚠️  StarkNet account not configured - read-only mode');
      }

      // Load contract
      const contractAddress = process.env.ATOMIQ_ADAPTER_CONTRACT_ADDRESS;
      if (!contractAddress) {
        throw new Error('ATOMIQ_ADAPTER_CONTRACT_ADDRESS not set in environment');
      }

      // Load ABI
      const abiPath = path.join(__dirname, '../../smart-contracts/contracts/adapters/AtomiqAdapterABI.json');
      if (!fs.existsSync(abiPath)) {
        throw new Error(`AtomiqAdapter ABI not found: ${abiPath}`);
      }

      const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      
      // Initialize contract
      this.contract = new Contract(
        contractAbi, 
        contractAddress, 
        this.account || this.provider
      );

      console.log('✅ AtomiqAdapter contract initialized:', contractAddress);

      this.initialized = true;

    } catch (error) {
      console.error('❌ Failed to initialize AtomiqAdapter service:', error);
      throw error;
    }
  }

  /**
   * Initiate a STRK -> BTC swap
   * @param {string} strkAmount - Amount in STRK (human readable)
   * @param {string} bitcoinAddress - Bitcoin destination address
   * @param {string} minBtcAmount - Minimum BTC amount expected
   * @returns {Promise<Object>} Swap initiation result
   */
  async initiateStrkToBtcSwap(strkAmount, bitcoinAddress, minBtcAmount) {
    try {
      await this.ensureInitialized();

      if (!this.account) {
        throw new Error('Account required for swap initiation');
      }

      // Convert amounts to contract format
      const strkAmountWei = uint256.bnToUint256(BigInt(Math.floor(parseFloat(strkAmount) * Math.pow(10, 18))));
      const minBtcAmountSatoshis = uint256.bnToUint256(BigInt(Math.floor(parseFloat(minBtcAmount) * 100000000)));

      console.log('Initiating STRK -> BTC swap:');
      console.log('  STRK Amount:', strkAmount, '(', strkAmountWei.toString(), 'wei)');
      console.log('  Bitcoin Address:', bitcoinAddress);
      console.log('  Min BTC Amount:', minBtcAmount, '(', minBtcAmountSatoshis.toString(), 'satoshis)');

      // Call contract function
      const result = await this.contract.initiate_strk_to_btc_swap(
        strkAmountWei,
        bitcoinAddress,
        minBtcAmountSatoshis
      );

      console.log('✅ Swap initiated. Transaction hash:', result.transaction_hash);

      // Wait for transaction confirmation
      await this.provider.waitForTransaction(result.transaction_hash);

      // Extract swap ID from transaction receipt
      const receipt = await this.provider.getTransactionReceipt(result.transaction_hash);
      const swapId = this.extractSwapIdFromReceipt(receipt);

      return {
        swapId: swapId,
        transactionHash: result.transaction_hash,
        status: 'initiated',
        strkAmount: strkAmount,
        bitcoinAddress: bitcoinAddress,
        minBtcAmount: minBtcAmount
      };

    } catch (error) {
      console.error('Error initiating STRK -> BTC swap:', error);
      throw error;
    }
  }

  /**
   * Get swap details by ID
   * @param {string} swapId - Swap ID
   * @returns {Promise<Object>} Swap details
   */
  async getSwap(swapId) {
    try {
      await this.ensureInitialized();

      const swapIdUint = uint256.bnToUint256(BigInt(swapId));
      const swap = await this.contract.get_swap(swapIdUint);

      return this.formatSwapData(swap);

    } catch (error) {
      console.error('Error getting swap:', error);
      throw error;
    }
  }

  /**
   * Get user's swaps
   * @param {string} userAddress - User's StarkNet address
   * @returns {Promise<Array>} List of user's swaps
   */
  async getUserSwaps(userAddress) {
    try {
      await this.ensureInitialized();

      const swapIds = await this.contract.get_user_swaps(userAddress);
      const swaps = [];

      for (const swapId of swapIds) {
        try {
          const swap = await this.getSwap(swapId.toString());
          swaps.push(swap);
        } catch (error) {
          console.warn('Failed to get swap', swapId.toString(), ':', error.message);
        }
      }

      return swaps;

    } catch (error) {
      console.error('Error getting user swaps:', error);
      throw error;
    }
  }

  /**
   * Confirm a swap (admin function)
   * @param {string} swapId - Swap ID
   * @param {string} txHash - StarkNet transaction hash
   * @returns {Promise<Object>} Confirmation result
   */
  async confirmSwap(swapId, txHash) {
    try {
      await this.ensureInitialized();

      if (!this.account) {
        throw new Error('Account required for swap confirmation');
      }

      const swapIdUint = uint256.bnToUint256(BigInt(swapId));
      const txHashFelt = BigInt(txHash);

      const result = await this.contract.confirm_swap(swapIdUint, txHashFelt);
      await this.provider.waitForTransaction(result.transaction_hash);

      console.log('✅ Swap confirmed. Transaction hash:', result.transaction_hash);

      return {
        swapId: swapId,
        transactionHash: result.transaction_hash,
        status: 'confirmed'
      };

    } catch (error) {
      console.error('Error confirming swap:', error);
      throw error;
    }
  }

  /**
   * Complete a swap (admin function)
   * @param {string} swapId - Swap ID
   * @param {string} bitcoinTxHash - Bitcoin transaction hash
   * @returns {Promise<Object>} Completion result
   */
  async completeSwap(swapId, bitcoinTxHash) {
    try {
      await this.ensureInitialized();

      if (!this.account) {
        throw new Error('Account required for swap completion');
      }

      const swapIdUint = uint256.bnToUint256(BigInt(swapId));

      const result = await this.contract.complete_swap(swapIdUint, bitcoinTxHash);
      await this.provider.waitForTransaction(result.transaction_hash);

      console.log('✅ Swap completed. Transaction hash:', result.transaction_hash);

      return {
        swapId: swapId,
        transactionHash: result.transaction_hash,
        bitcoinTxHash: bitcoinTxHash,
        status: 'completed'
      };

    } catch (error) {
      console.error('Error completing swap:', error);
      throw error;
    }
  }

  /**
   * Refund a swap
   * @param {string} swapId - Swap ID
   * @returns {Promise<Object>} Refund result
   */
  async refundSwap(swapId) {
    try {
      await this.ensureInitialized();

      if (!this.account) {
        throw new Error('Account required for swap refund');
      }

      const swapIdUint = uint256.bnToUint256(BigInt(swapId));

      const result = await this.contract.refund_swap(swapIdUint);
      await this.provider.waitForTransaction(result.transaction_hash);

      console.log('✅ Swap refunded. Transaction hash:', result.transaction_hash);

      return {
        swapId: swapId,
        transactionHash: result.transaction_hash,
        status: 'refunded'
      };

    } catch (error) {
      console.error('Error refunding swap:', error);
      throw error;
    }
  }

  /**
   * Get total swap count
   * @returns {Promise<number>} Total number of swaps
   */
  async getSwapCount() {
    try {
      await this.ensureInitialized();

      const count = await this.contract.get_swap_count();
      return parseInt(count.toString());

    } catch (error) {
      console.error('Error getting swap count:', error);
      throw error;
    }
  }

  /**
   * Format swap data from contract response
   * @param {Object} swap - Raw swap data from contract
   * @returns {Object} Formatted swap data
   */
  formatSwapData(swap) {
    return {
      id: swap.id.toString(),
      user: swap.user,
      fromToken: swap.from_token,
      toToken: swap.to_token,
      fromAmount: (parseInt(swap.from_amount.toString()) / Math.pow(10, 18)).toString(),
      toAmount: (parseInt(swap.to_amount.toString()) / 100000000).toString(),
      fee: (parseInt(swap.fee.toString()) / Math.pow(10, 18)).toString(),
      status: this.formatSwapStatus(swap.status),
      bitcoinAddress: swap.bitcoin_address,
      starknetTxHash: swap.starknet_tx_hash.toString(),
      bitcoinTxHash: swap.bitcoin_tx_hash,
      createdAt: new Date(parseInt(swap.created_at.toString()) * 1000).toISOString(),
      expiresAt: new Date(parseInt(swap.expires_at.toString()) * 1000).toISOString(),
      settledAt: swap.settled_at.toString() !== '0' 
        ? new Date(parseInt(swap.settled_at.toString()) * 1000).toISOString() 
        : null
    };
  }

  /**
   * Format swap status from contract enum
   * @param {Object} status - Status enum from contract
   * @returns {string} Human readable status
   */
  formatSwapStatus(status) {
    const statusMap = {
      0: 'pending',
      1: 'initiated', 
      2: 'confirmed',
      3: 'completed',
      4: 'failed',
      5: 'refunded'
    };

    return statusMap[status] || 'unknown';
  }

  /**
   * Extract swap ID from transaction receipt
   * @param {Object} receipt - Transaction receipt
   * @returns {string} Swap ID
   */
  extractSwapIdFromReceipt(receipt) {
    try {
      // Look for SwapInitiated event in the receipt
      for (const event of receipt.events || []) {
        if (event.keys && event.keys[0] === 'SwapInitiated') {
          // The swap ID should be in the event data
          return event.data[0];
        }
      }
      
      // Fallback: return a generated ID based on transaction hash
      return receipt.transaction_hash.slice(-8);
      
    } catch (error) {
      console.warn('Could not extract swap ID from receipt:', error.message);
      return 'unknown';
    }
  }

  /**
   * Ensure service is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Export singleton instance
module.exports = new AtomiqAdapterService();