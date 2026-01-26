const { newSwapper, Tokens, SwapAmountType } = require('@atomiqlabs/sdk');
const { StarknetChain } = require('@atomiqlabs/chain-starknet');
const { SqliteStorageManager } = require('@atomiqlabs/storage-sqlite');
const path = require('path');
require('dotenv').config();

/**
 * Atomiq Service - Backend Dev 3
 * Handles cross-chain swaps between Bitcoin and StarkNet
 * Implementation based on official Atomiq SDK documentation
 */

class AtomiqService {
  constructor() {
    this.swapper = null;
    this.initialized = false;
  }

  /**
   * Initialize Atomiq SDK with StarkNet support
   * Based on: https://www.npmjs.com/package/@atomiqlabs/sdk
   */
  async initialize() {
    try {
      if (this.initialized) {
        return;
      }

      console.log('Initializing Atomiq SDK...');

      // Set up storage for swap state persistence (NodeJS requires sqlite)
      const storageManager = new SqliteStorageManager(
        path.join(__dirname, '../data/atomiq-swaps.db')
      );

      // Configure StarkNet RPC URL
      const starknetRpcUrl = process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io';

      // Create swapper factory with StarkNet support
      // Note: "as const" keyword is required for proper TypeScript type inference
      this.swapper = await newSwapper(
        {
          starknet: new StarknetChain(starknetRpcUrl)
        },
        storageManager,
        {
          // Optional: Custom pricing API
          pricingApiUrl: process.env.ATOMIQ_PRICING_API,
          // Optional: Custom mempool.space RPC
          bitcoinRpcUrl: process.env.BITCOIN_RPC_URL,
          // HTTP request timeout
          requestTimeout: 30000
        }
      );

      // Initialize the swapper (checks existing swaps and does LP discovery)
      await this.swapper.init();

      this.initialized = true;
      console.log('✅ Atomiq SDK initialized successfully');

      // Set up event listeners
      this.setupEventListeners();

    } catch (error) {
      console.error('❌ Failed to initialize Atomiq SDK:', error);
      throw error;
    }
  }

  /**
   * Set up event listeners for swap state changes
   */
  setupEventListeners() {
    // Listen for swap limits changes
    this.swapper.on('swapLimitsChanged', () => {
      console.log('Swap limits updated');
    });

    // Listen for swap state changes
    this.swapper.on('swapStateChange', (swap) => {
      console.log(`Swap ${swap.getId()} state changed to: ${swap.getState()}`);
    });
  }

  /**
   * Get swap quote for BTC -> STRK
   * @param {string} amount - Amount in satoshis or STRK (depending on exactIn)
   * @param {boolean} exactIn - If true, amount is input (BTC), if false, amount is output (STRK)
   * @param {string} destinationAddress - StarkNet destination address
   * @returns {Promise<Object>} Swap quote details
   */
  async getSwapQuote(amount, exactIn = true, destinationAddress) {
    try {
      await this.ensureInitialized();

      const amountBigInt = BigInt(amount);
      const swapAmountType = exactIn ? SwapAmountType.EXACT_IN : SwapAmountType.EXACT_OUT;

      // Create swap quote
      const swap = await this.swapper.swap(
        Tokens.BITCOIN.BTC,           // From Bitcoin
        Tokens.STARKNET.STRK,          // To StarkNet STRK
        amountBigInt,                  // Amount
        swapAmountType,                // Exact in or out
        undefined,                     // Source address (not needed for BTC -> STRK)
        destinationAddress             // Destination StarkNet address
      );

      // Get quote details
      const quote = {
        swap_id: swap.getId(),
        from_token: 'BTC',
        to_token: 'STRK',
        from_amount: swap.getInput().toString(),
        to_amount: swap.getOutput().toString(),
        fee: swap.getFee().amountInSrcToken.toString(),
        input_without_fee: swap.getInputWithoutFee().toString(),
        price_info: {
          swap_price: swap.getPriceInfo().swapPrice,
          market_price: swap.getPriceInfo().marketPrice,
          difference: swap.getPriceInfo().difference
        },
        expiry: swap.getQuoteExpiry(),
        expires_at: new Date(swap.getQuoteExpiry()).toISOString(),
        bitcoin_address: swap.getAddress(), // Bitcoin address to send to
        state: swap.getState()
      };

      return quote;

    } catch (error) {
      console.error('Error getting swap quote:', error);
      throw error;
    }
  }

  /**
   * Get swap quote for STRK -> BTC
   * @param {string} amount - Amount in STRK or satoshis (depending on exactIn)
   * @param {boolean} exactIn - If true, amount is input (STRK), if false, amount is output (BTC)
   * @param {string} sourceAddress - StarkNet source address
   * @param {string} bitcoinAddress - Bitcoin destination address
   * @returns {Promise<Object>} Swap quote details
   */
  async getSwapQuoteReverse(amount, exactIn = true, sourceAddress, bitcoinAddress) {
    try {
      await this.ensureInitialized();

      const amountBigInt = BigInt(amount);
      const swapAmountType = exactIn ? SwapAmountType.EXACT_IN : SwapAmountType.EXACT_OUT;

      // Create swap quote (STRK -> BTC)
      // For STRK -> BTC, we use the main swapper (not chain-specific)
      const swap = await this.swapper.swap(
        Tokens.STARKNET.STRK,          // From StarkNet STRK
        Tokens.BITCOIN.BTC,            // To Bitcoin
        amountBigInt,                  // Amount
        swapAmountType,                // Exact in or out
        sourceAddress,                 // Source StarkNet address
        bitcoinAddress                 // Destination Bitcoin address
      );

      // Get quote details
      const quote = {
        swap_id: swap.getId(),
        from_token: 'STRK',
        to_token: 'BTC',
        from_amount: swap.getInput().toString(),
        to_amount: swap.getOutput().toString(),
        fee: swap.getFee().amountInSrcToken.toString(),
        input_without_fee: swap.getInputWithoutFee().toString(),
        price_info: {
          swap_price: swap.getPriceInfo().swapPrice,
          market_price: swap.getPriceInfo().marketPrice,
          difference: swap.getPriceInfo().difference
        },
        expiry: swap.getQuoteExpiry(),
        expires_at: new Date(swap.getQuoteExpiry()).toISOString(),
        state: swap.getState()
      };

      return quote;

    } catch (error) {
      console.error('Error getting reverse swap quote:', error);
      throw error;
    }
  }

  /**
   * Execute BTC -> STRK swap
   * @param {string} swapId - Swap ID from quote
   * @param {Object} bitcoinWallet - Bitcoin wallet details
   * @param {Object} callbacks - Callback functions for swap events
   * @returns {Promise<Object>} Swap execution result
   */
  async executeSwap(swapId, bitcoinWallet, callbacks = {}) {
    try {
      await this.ensureInitialized();

      // Retrieve swap from storage
      const swap = await this.swapper.getSwap(swapId);
      
      if (!swap) {
        throw new Error('Swap not found');
      }

      // Execute the swap with automatic settlement
      const automaticSettlementSuccess = await swap.execute(
        bitcoinWallet,
        {
          onSourceTransactionSent: (txId) => {
            console.log(`Bitcoin transaction sent: ${txId}`);
            if (callbacks.onSourceTransactionSent) {
              callbacks.onSourceTransactionSent(txId);
            }
          },
          onSourceTransactionConfirmationStatus: (txId, confirmations, targetConfirmations, txEtaMs) => {
            console.log(`Bitcoin tx ${txId}: ${confirmations}/${targetConfirmations} confirmations`);
            if (callbacks.onSourceTransactionConfirmationStatus) {
              callbacks.onSourceTransactionConfirmationStatus(txId, confirmations, targetConfirmations, txEtaMs);
            }
          },
          onSourceTransactionConfirmed: (txId) => {
            console.log(`Bitcoin transaction confirmed: ${txId}`);
            if (callbacks.onSourceTransactionConfirmed) {
              callbacks.onSourceTransactionConfirmed(txId);
            }
          },
          onSwapSettled: (destinationTxId) => {
            console.log(`Swap settled on StarkNet: ${destinationTxId}`);
            if (callbacks.onSwapSettled) {
              callbacks.onSwapSettled(destinationTxId);
            }
          }
        }
      );

      return {
        swap_id: swapId,
        automatic_settlement: automaticSettlementSuccess,
        state: swap.getState(),
        message: automaticSettlementSuccess 
          ? 'Swap executed and settled automatically' 
          : 'Swap executed, manual settlement required'
      };

    } catch (error) {
      console.error('Error executing swap:', error);
      throw error;
    }
  }

  /**
   * Execute STRK -> BTC swap
   * @param {string} swapId - Swap ID from quote
   * @param {Object} starknetWallet - StarkNet wallet/signer
   * @param {Object} callbacks - Callback functions for swap events
   * @returns {Promise<Object>} Swap execution result
   */
  async executeSwapReverse(swapId, starknetWallet, callbacks = {}) {
    try {
      await this.ensureInitialized();

      // Retrieve swap from storage
      const swap = await this.swapper.getSwap(swapId);
      
      if (!swap) {
        throw new Error('Swap not found');
      }

      // Execute the swap
      const automaticSettlementSuccess = await swap.execute(
        starknetWallet,
        {
          onDestinationCommitSent: (txId) => {
            console.log(`StarkNet commit transaction sent: ${txId}`);
            if (callbacks.onDestinationCommitSent) {
              callbacks.onDestinationCommitSent(txId);
            }
          },
          onSwapSettled: (bitcoinTxId) => {
            console.log(`Swap settled on Bitcoin: ${bitcoinTxId}`);
            if (callbacks.onSwapSettled) {
              callbacks.onSwapSettled(bitcoinTxId);
            }
          }
        }
      );

      return {
        swap_id: swapId,
        automatic_settlement: automaticSettlementSuccess,
        state: swap.getState(),
        message: automaticSettlementSuccess 
          ? 'Swap executed and settled automatically' 
          : 'Swap executed, manual settlement required'
      };

    } catch (error) {
      console.error('Error executing reverse swap:', error);
      throw error;
    }
  }

  /**
   * Get swap status and details
   * @param {string} swapId - Swap ID
   * @returns {Promise<Object>} Swap status
   */
  async getSwapStatus(swapId) {
    try {
      await this.ensureInitialized();

      const swap = await this.swapper.getSwap(swapId);
      
      if (!swap) {
        throw new Error('Swap not found');
      }

      return {
        swap_id: swapId,
        state: swap.getState(),
        from_token: swap.getFromToken().symbol,
        to_token: swap.getToToken().symbol,
        from_amount: swap.getInput().toString(),
        to_amount: swap.getOutput().toString(),
        fee: swap.getFee().amountInSrcToken.toString(),
        expiry: swap.getQuoteExpiry(),
        expires_at: new Date(swap.getQuoteExpiry()).toISOString(),
        created_at: new Date().toISOString() // TODO: Get actual creation time from swap
      };

    } catch (error) {
      console.error('Error getting swap status:', error);
      throw error;
    }
  }

  /**
   * Get swap limits for BTC <-> STRK
   * @returns {Object} Swap limits
   */
  async getSwapLimits() {
    try {
      await this.ensureInitialized();

      const btcToStrkLimits = this.swapper.getSwapLimits(Tokens.BITCOIN.BTC, Tokens.STARKNET.STRK);
      const strkToBtcLimits = this.swapper.getSwapLimits(Tokens.STARKNET.STRK, Tokens.BITCOIN.BTC);

      return {
        btc_to_strk: {
          input: {
            min: btcToStrkLimits.input.min?.toString() || '0',
            max: btcToStrkLimits.input.max?.toString() || '0'
          },
          output: {
            min: btcToStrkLimits.output.min?.toString() || '0',
            max: btcToStrkLimits.output.max?.toString() || '0'
          }
        },
        strk_to_btc: {
          input: {
            min: strkToBtcLimits.input.min?.toString() || '0',
            max: strkToBtcLimits.input.max?.toString() || '0'
          },
          output: {
            min: strkToBtcLimits.output.min?.toString() || '0',
            max: strkToBtcLimits.output.max?.toString() || '0'
          }
        }
      };

    } catch (error) {
      console.error('Error getting swap limits:', error);
      throw error;
    }
  }

  /**
   * Get all swaps for a user
   * @returns {Promise<Array>} List of swaps
   */
  async getAllSwaps() {
    try {
      await this.ensureInitialized();

      const swaps = await this.swapper.getAllSwaps();
      
      return swaps.map(swap => ({
        swap_id: swap.getId(),
        state: swap.getState(),
        from_token: swap.getFromToken().symbol,
        to_token: swap.getToToken().symbol,
        from_amount: swap.getInput().toString(),
        to_amount: swap.getOutput().toString(),
        expiry: swap.getQuoteExpiry()
      }));

    } catch (error) {
      console.error('Error getting all swaps:', error);
      throw error;
    }
  }

  /**
   * Get swaps ready to be claimed
   * @returns {Promise<Array>} List of claimable swaps
   */
  async getClaimableSwaps() {
    try {
      await this.ensureInitialized();

      const claimableSwaps = await this.swapper.getClaimableSwaps();
      
      return claimableSwaps.map(swap => ({
        swap_id: swap.getId(),
        state: swap.getState(),
        from_token: swap.getFromToken().symbol,
        to_token: swap.getToToken().symbol,
        to_amount: swap.getOutput().toString()
      }));

    } catch (error) {
      console.error('Error getting claimable swaps:', error);
      throw error;
    }
  }

  /**
   * Get swaps ready to be refunded
   * @returns {Promise<Array>} List of refundable swaps
   */
  async getRefundableSwaps() {
    try {
      await this.ensureInitialized();

      const refundableSwaps = await this.swapper.getRefundableSwaps();
      
      return refundableSwaps.map(swap => ({
        swap_id: swap.getId(),
        state: swap.getState(),
        from_token: swap.getFromToken().symbol,
        to_token: swap.getToToken().symbol,
        from_amount: swap.getInput().toString()
      }));

    } catch (error) {
      console.error('Error getting refundable swaps:', error);
      throw error;
    }
  }

  /**
   * Claim a swap manually
   * @param {string} swapId - Swap ID
   * @param {Object} wallet - Wallet/signer for claiming
   * @returns {Promise<Object>} Claim result
   */
  async claimSwap(swapId, wallet) {
    try {
      await this.ensureInitialized();

      const swap = await this.swapper.getSwap(swapId);
      
      if (!swap) {
        throw new Error('Swap not found');
      }

      await swap.claim(wallet);

      return {
        swap_id: swapId,
        state: swap.getState(),
        message: 'Swap claimed successfully'
      };

    } catch (error) {
      console.error('Error claiming swap:', error);
      throw error;
    }
  }

  /**
   * Refund a swap
   * @param {string} swapId - Swap ID
   * @param {Object} wallet - Wallet/signer for refund
   * @returns {Promise<Object>} Refund result
   */
  async refundSwap(swapId, wallet) {
    try {
      await this.ensureInitialized();

      const swap = await this.swapper.getSwap(swapId);
      
      if (!swap) {
        throw new Error('Swap not found');
      }

      await swap.refund(wallet);

      return {
        swap_id: swapId,
        state: swap.getState(),
        message: 'Swap refunded successfully'
      };

    } catch (error) {
      console.error('Error refunding swap:', error);
      throw error;
    }
  }

  /**
   * Ensure SDK is initialized
   */
  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// Export singleton instance
module.exports = new AtomiqService();
