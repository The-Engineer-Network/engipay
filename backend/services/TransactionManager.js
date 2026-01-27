const { Account, hash, CallData } = require('starknet');
const { getVesuConfig } = require('../config/vesu.config');

/**
 * TransactionManager
 * 
 * Manages Starknet transaction lifecycle including:
 * - Gas estimation
 * - Transaction signing with account abstraction
 * - Transaction submission with retry logic
 * - Transaction confirmation monitoring
 * - Transaction status tracking
 * 
 * Features:
 * - Automatic retry on transient failures
 * - Configurable timeout for confirmations
 * - Gas estimation with safety buffer
 * - Comprehensive error handling
 */
class TransactionManager {
  constructor(provider, accountAddress = null, privateKey = null) {
    this.provider = provider;
    this.accountAddress = accountAddress || process.env.STARKNET_ACCOUNT_ADDRESS;
    this.privateKey = privateKey || process.env.STARKNET_PRIVATE_KEY;
    
    // Configuration from vesu.config.js
    this.config = getVesuConfig();
    this.txConfig = this.config.transaction;
    
    // Initialize account if credentials provided
    this.account = null;
    if (this.accountAddress && this.privateKey) {
      this.initializeAccount();
    }
    
    console.log('TransactionManager initialized');
  }

  /**
   * Initialize Starknet account for signing transactions
   */
  initializeAccount() {
    try {
      this.account = new Account(
        this.provider,
        this.accountAddress,
        this.privateKey
      );
      console.log(`Account initialized: ${this.accountAddress}`);
    } catch (error) {
      console.error('Failed to initialize account:', error.message);
      throw new Error(`Account initialization failed: ${error.message}`);
    }
  }

  /**
   * Estimate gas for a transaction
   * @param {string} contractAddress - Target contract address
   * @param {string} method - Method to call
   * @param {Array} params - Method parameters
   * @returns {Promise<Object>} Gas estimation result
   */
  async estimateGas(contractAddress, method, params = []) {
    try {
      if (!this.account) {
        throw new Error('Account not initialized. Cannot estimate gas.');
      }

      console.log(`Estimating gas for ${method} at ${contractAddress}`);

      // Prepare the call
      const call = {
        contractAddress: contractAddress,
        entrypoint: method,
        calldata: params,
      };

      // Estimate fee using account
      const feeEstimate = await this.account.estimateFee([call]);

      // Apply gas multiplier for safety buffer
      const gasMultiplier = this.txConfig.gasMultiplier || 1.1;
      const adjustedGas = {
        overall_fee: BigInt(Math.ceil(Number(feeEstimate.overall_fee) * gasMultiplier)),
        gas_consumed: BigInt(Math.ceil(Number(feeEstimate.gas_consumed) * gasMultiplier)),
        gas_price: feeEstimate.gas_price,
        suggestedMaxFee: BigInt(Math.ceil(Number(feeEstimate.suggestedMaxFee) * gasMultiplier)),
      };

      console.log(`Gas estimated: ${adjustedGas.overall_fee.toString()} (with ${gasMultiplier}x buffer)`);

      return adjustedGas;
    } catch (error) {
      console.error('Gas estimation failed:', error.message);
      throw new Error(`Gas estimation failed: ${error.message}`);
    }
  }

  /**
   * Sign a transaction using account abstraction
   * @param {Object} transaction - Transaction to sign
   * @returns {Promise<Object>} Signed transaction
   */
  async signTransaction(transaction) {
    try {
      if (!this.account) {
        throw new Error('Account not initialized. Cannot sign transaction.');
      }

      console.log('Signing transaction...');

      // The Account class in starknet.js handles signing internally
      // This method is a placeholder for explicit signing if needed
      // In practice, execute() handles signing automatically

      return {
        signed: true,
        transaction: transaction,
      };
    } catch (error) {
      console.error('Transaction signing failed:', error.message);
      throw new Error(`Transaction signing failed: ${error.message}`);
    }
  }

  /**
   * Submit a transaction to Starknet with retry logic
   * @param {string} contractAddress - Target contract address
   * @param {string} method - Method to call
   * @param {Array} params - Method parameters
   * @param {Object} options - Additional options (maxFee, etc.)
   * @returns {Promise<Object>} Transaction result with hash
   */
  async submitTransaction(contractAddress, method, params = [], options = {}) {
    const maxRetries = this.txConfig.maxRetries || 3;
    const retryDelay = this.txConfig.retryDelay || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.account) {
          throw new Error('Account not initialized. Cannot submit transaction.');
        }

        console.log(`Submitting transaction (attempt ${attempt}/${maxRetries}): ${method}`);

        // Prepare the call
        const call = {
          contractAddress: contractAddress,
          entrypoint: method,
          calldata: params,
        };

        // Execute transaction
        const executeOptions = {};
        if (options.maxFee) {
          executeOptions.maxFee = options.maxFee;
        }

        const result = await this.account.execute([call], undefined, executeOptions);

        console.log(`Transaction submitted successfully: ${result.transaction_hash}`);

        return {
          transaction_hash: result.transaction_hash,
          status: 'PENDING',
          attempt: attempt,
        };
      } catch (error) {
        console.error(`Transaction submission failed (attempt ${attempt}):`, error.message);

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        if (attempt < maxRetries && isRetryable) {
          console.log(`Retrying in ${retryDelay}ms...`);
          await this.sleep(retryDelay);
          continue;
        }

        // Max retries reached or non-retryable error
        throw new Error(`Transaction submission failed after ${attempt} attempts: ${error.message}`);
      }
    }
  }

  /**
   * Wait for transaction confirmation
   * @param {string} transactionHash - Transaction hash to monitor
   * @param {number} maxWait - Maximum wait time in milliseconds
   * @returns {Promise<Object>} Transaction receipt
   */
  async waitForConfirmation(transactionHash, maxWait = null) {
    const timeout = maxWait || this.txConfig.confirmationTimeout || 300000; // 5 minutes default
    const startTime = Date.now();

    console.log(`Waiting for transaction confirmation: ${transactionHash}`);

    try {
      while (Date.now() - startTime < timeout) {
        try {
          // Get transaction receipt
          const receipt = await this.provider.getTransactionReceipt(transactionHash);

          // Check transaction status
          if (receipt.execution_status === 'SUCCEEDED') {
            console.log(`Transaction confirmed: ${transactionHash}`);
            return {
              transaction_hash: transactionHash,
              status: 'CONFIRMED',
              execution_status: receipt.execution_status,
              block_number: receipt.block_number,
              receipt: receipt,
            };
          } else if (receipt.execution_status === 'REVERTED') {
            throw new Error(`Transaction reverted: ${transactionHash}`);
          }

          // Transaction still pending, wait and retry
          await this.sleep(5000); // Check every 5 seconds
        } catch (error) {
          // Transaction not found yet, continue waiting
          if (error.message.includes('Transaction hash not found')) {
            await this.sleep(5000);
            continue;
          }
          throw error;
        }
      }

      // Timeout reached
      throw new Error(`Transaction confirmation timeout after ${timeout}ms: ${transactionHash}`);
    } catch (error) {
      console.error('Transaction confirmation failed:', error.message);
      throw new Error(`Transaction confirmation failed: ${error.message}`);
    }
  }

  /**
   * Get transaction status
   * @param {string} transactionHash - Transaction hash
   * @returns {Promise<Object>} Transaction status
   */
  async getTransactionStatus(transactionHash) {
    try {
      console.log(`Fetching transaction status: ${transactionHash}`);

      const receipt = await this.provider.getTransactionReceipt(transactionHash);

      return {
        transaction_hash: transactionHash,
        status: receipt.execution_status || 'UNKNOWN',
        block_number: receipt.block_number,
        finality_status: receipt.finality_status,
        execution_status: receipt.execution_status,
      };
    } catch (error) {
      // Transaction not found
      if (error.message.includes('Transaction hash not found')) {
        return {
          transaction_hash: transactionHash,
          status: 'NOT_FOUND',
        };
      }

      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }

  /**
   * Execute operation with retry logic
   * @param {Function} operation - Async operation to execute
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry(operation, maxRetries = 3) {
    const retryDelay = this.txConfig.retryDelay || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Executing operation (attempt ${attempt}/${maxRetries})`);
        const result = await operation();
        return result;
      } catch (error) {
        console.error(`Operation failed (attempt ${attempt}):`, error.message);

        const isRetryable = this.isRetryableError(error);

        if (attempt < maxRetries && isRetryable) {
          console.log(`Retrying in ${retryDelay}ms...`);
          await this.sleep(retryDelay);
          continue;
        }

        throw new Error(`Operation failed after ${attempt} attempts: ${error.message}`);
      }
    }
  }

  /**
   * Check if error is retryable
   * @param {Error} error - Error to check
   * @returns {boolean} True if retryable
   */
  isRetryableError(error) {
    const retryablePatterns = [
      'network',
      'timeout',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'rate limit',
      'too many requests',
      'service unavailable',
      'gateway timeout',
    ];

    const errorMessage = error.message.toLowerCase();
    return retryablePatterns.some(pattern => errorMessage.includes(pattern));
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Submit and wait for transaction (convenience method)
   * @param {string} contractAddress - Target contract address
   * @param {string} method - Method to call
   * @param {Array} params - Method parameters
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Confirmed transaction result
   */
  async submitAndWait(contractAddress, method, params = [], options = {}) {
    try {
      // Submit transaction
      const submitResult = await this.submitTransaction(contractAddress, method, params, options);

      // Wait for confirmation
      const confirmResult = await this.waitForConfirmation(submitResult.transaction_hash);

      return confirmResult;
    } catch (error) {
      throw new Error(`Submit and wait failed: ${error.message}`);
    }
  }

  /**
   * Estimate gas and submit transaction
   * @param {string} contractAddress - Target contract address
   * @param {string} method - Method to call
   * @param {Array} params - Method parameters
   * @returns {Promise<Object>} Transaction result
   */
  async estimateAndSubmit(contractAddress, method, params = []) {
    try {
      // Estimate gas
      const gasEstimate = await this.estimateGas(contractAddress, method, params);

      // Submit with estimated max fee
      const result = await this.submitTransaction(contractAddress, method, params, {
        maxFee: gasEstimate.suggestedMaxFee,
      });

      return result;
    } catch (error) {
      throw new Error(`Estimate and submit failed: ${error.message}`);
    }
  }

  /**
   * Execute supply transaction on Vesu Pool contract
   * @param {string} poolAddress - Pool contract address
   * @param {string} asset - Asset symbol to supply
   * @param {string} amount - Amount to supply (as string to preserve precision)
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<string>} Transaction hash
   */
  async executeSupply(poolAddress, asset, amount, walletAddress) {
    try {
      console.log('TransactionManager.executeSupply called', {
        poolAddress,
        asset,
        amount,
        walletAddress
      });

      // Convert amount to contract format (typically uint256)
      // For Starknet, we need to handle felt252 format
      const amountFelt = CallData.compile([amount]);

      // Prepare parameters for supply call
      // The exact parameters depend on Vesu V2 Pool contract interface
      // Typical supply signature: supply(asset, amount, onBehalfOf)
      const params = CallData.compile([
        asset,
        amount,
        walletAddress
      ]);

      console.log('Submitting supply transaction', { poolAddress, params });

      // Submit transaction
      const result = await this.submitTransaction(
        poolAddress,
        'supply', // Method name in Vesu Pool contract
        params
      );

      console.log('Supply transaction submitted', { transactionHash: result.transaction_hash });

      return result.transaction_hash;
    } catch (error) {
      console.error('Execute supply failed:', error.message);
      throw new Error(`Execute supply failed: ${error.message}`);
    }
  }

  /**
   * Execute borrow transaction on Vesu Pool contract
   * Task 8.3.1: Add executeBorrow() method similar to executeSupply()
   * 
   * @param {string} poolAddress - Pool contract address
   * @param {string} collateralAsset - Collateral asset symbol
   * @param {string} debtAsset - Debt asset symbol to borrow
   * @param {string} borrowAmount - Amount to borrow (as string to preserve precision)
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<string>} Transaction hash
   */
  async executeBorrow(poolAddress, collateralAsset, debtAsset, borrowAmount, walletAddress) {
    try {
      console.log('TransactionManager.executeBorrow called', {
        poolAddress,
        collateralAsset,
        debtAsset,
        borrowAmount,
        walletAddress
      });

      // Task 8.3.2: Prepare calldata for borrow transaction
      // The exact parameters depend on Vesu V2 Pool contract interface
      // Typical borrow signature: borrow(collateralAsset, debtAsset, borrowAmount, onBehalfOf)
      const params = CallData.compile([
        collateralAsset,
        debtAsset,
        borrowAmount,
        walletAddress
      ]);

      console.log('Submitting borrow transaction', { poolAddress, params });

      // Task 8.3.3: Submit transaction to pool contract's borrow() method
      const result = await this.submitTransaction(
        poolAddress,
        'borrow', // Method name in Vesu Pool contract
        params
      );

      console.log('Borrow transaction submitted', { transactionHash: result.transaction_hash });

      return result.transaction_hash;
    } catch (error) {
      console.error('Execute borrow failed:', error.message);
      throw new Error(`Execute borrow failed: ${error.message}`);
    }
  }

  /**
   * Execute repay transaction on Vesu Pool contract
   * Task 9.2.1: Add executeRepay() method to TransactionManager class
   * 
   * @param {string} poolAddress - Pool contract address
   * @param {string} debtAsset - Debt asset symbol to repay
   * @param {string} repayAmount - Amount to repay (as string to preserve precision)
   * @param {string} positionId - Position ID for tracking
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<string>} Transaction hash
   */
  async executeRepay(poolAddress, debtAsset, repayAmount, positionId, walletAddress) {
    try {
      console.log('TransactionManager.executeRepay called', {
        poolAddress,
        debtAsset,
        repayAmount,
        positionId,
        walletAddress
      });

      // Task 9.2.2: Prepare calldata for repay transaction (debtAsset, repayAmount, positionId)
      // The exact parameters depend on Vesu V2 Pool contract interface
      // Typical repay signature: repay(debtAsset, repayAmount, onBehalfOf)
      const params = CallData.compile([
        debtAsset,
        repayAmount,
        walletAddress
      ]);

      console.log('Submitting repay transaction', { poolAddress, params });

      // Task 9.2.3: Submit transaction to pool contract's repay() method
      const result = await this.submitTransaction(
        poolAddress,
        'repay', // Method name in Vesu Pool contract
        params
      );

      console.log('Repay transaction submitted', { transactionHash: result.transaction_hash });

      return result.transaction_hash;
    } catch (error) {
      console.error('Execute repay failed:', error.message);
      throw new Error(`Execute repay failed: ${error.message}`);
    }
  }
}

module.exports = TransactionManager;
