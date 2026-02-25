const { Account: TongoAccount } = require('@fatsolutions/tongo-sdk');
const { Account, RpcProvider } = require('starknet');
const { 
  getTongoContractAddress, 
  getERC20ContractAddress,
  getSupportedTokens,
  erc20ToTongo,
  tongoToERC20
} = require('../config/tongo-contracts');
require('dotenv').config();

/**
 * Tongo Service V2 - Aligned with Official SDK
 * Based on official documentation: https://docs.tongo.cash/
 * Using official contract addresses: https://docs.tongo.cash/protocol/contracts.html
 * 
 * Tongo Operations:
 * 1. Fund - Convert ERC20 to encrypted Tongo tokens
 * 2. Transfer - Private transfer with hidden amounts
 * 3. Rollover - Move pending balance to current balance
 * 4. Withdraw - Convert Tongo tokens back to ERC20
 * 
 * Balance Structure:
 * - Current Balance: Available for transfers/withdrawals
 * - Pending Balance: Received transfers, needs rollover
 */

class TongoServiceV2 {
  constructor() {
    this.provider = null;
    this.signer = null;
    this.network = null;
    this.initialized = false;
  }

  /**
   * Initialize Tongo service with Starknet provider and signer
   */
  async initialize() {
    try {
      if (this.initialized) {
        return;
      }

      console.log('Initializing Tongo Service V2 with official contracts...');

      // Determine network
      this.network = process.env.STARKNET_NETWORK || 'sepolia';

      // Setup Starknet provider
      this.provider = new RpcProvider({
        nodeUrl: process.env.STARKNET_RPC_URL || 'https://rpc.starknet.lava.build',
        specVersion: "0.8.1",
      });

      // Setup Starknet signer (pays gas fees)
      this.signer = new Account(
        this.provider,
        process.env.STARKNET_ACCOUNT_ADDRESS,
        process.env.STARKNET_PRIVATE_KEY
      );

      this.initialized = true;
      console.log(`✅ Tongo Service V2 initialized successfully on ${this.network}`);
      console.log(`📋 Supported tokens: ${getSupportedTokens(this.network).map(t => t.symbol).join(', ')}`);

    } catch (error) {
      console.error('❌ Failed to initialize Tongo Service V2:', error);
      throw error;
    }
  }

  /**
   * Create Tongo account instance for a user
   * @param {string} userTongoPrivateKey - User's Tongo private key (separate from Starknet key)
   * @param {string} tokenSymbol - Token symbol (STRK, ETH, USDC)
   * @returns {TongoAccount} Tongo account instance
   */
  createTongoAccount(userTongoPrivateKey, tokenSymbol) {
    const tongoContractAddress = getTongoContractAddress(tokenSymbol, this.network);

    return new TongoAccount(
      userTongoPrivateKey,
      tongoContractAddress,
      this.provider
    );
  }

  /**
   * Fund operation - Convert ERC20 tokens to encrypted Tongo tokens
   * Adds to Current Balance
   * 
   * @param {string} userTongoPrivateKey - User's Tongo private key
   * @param {string} amount - Amount to fund (in wei)
   * @param {string} tokenSymbol - Token symbol (STRK, ETH, USDC)
   * @returns {Promise<Object>} Transaction result
   */
  async fund(userTongoPrivateKey, amount, tokenSymbol) {
    try {
      await this.ensureInitialized();

      console.log(`💰 Funding Tongo account with ${amount} ${tokenSymbol}...`);

      const tongoAccount = this.createTongoAccount(userTongoPrivateKey, tokenSymbol);
      const tokenAddress = getERC20ContractAddress(tokenSymbol, this.network);

      // Create fund operation
      const operation = tongoAccount.fund({
        amount: amount,
        token: tokenAddress
      });

      // Convert to calldata
      const call = operation.toCalldata();

      // Execute with Starknet signer
      const result = await this.signer.execute(call);

      console.log(`✅ Fund operation successful: ${result.transaction_hash}`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        operation: 'fund',
        amount,
        token: tokenSymbol,
        token_address: tokenAddress,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'ERC20 tokens converted to encrypted Tongo tokens'
      };

    } catch (error) {
      console.error('Error funding Tongo account:', error);
      throw error;
    }
  }

  /**
   * Transfer operation - Private transfer with hidden amounts
   * Sender: Subtracts from Current Balance
   * Recipient: Adds to Pending Balance
   * 
   * @param {string} userTongoPrivateKey - Sender's Tongo private key
   * @param {string} recipientTongoPublicKey - Recipient's Tongo public key
   * @param {string} amount - Amount to transfer (encrypted)
   * @param {string} tokenSymbol - Token symbol (STRK, ETH, USDC)
   * @returns {Promise<Object>} Transaction result
   */
  async transfer(userTongoPrivateKey, recipientTongoPublicKey, amount, tokenSymbol) {
    try {
      await this.ensureInitialized();

      console.log(`🔒 Initiating private ${tokenSymbol} transfer to ${recipientTongoPublicKey.substring(0, 10)}...`);

      const tongoAccount = this.createTongoAccount(userTongoPrivateKey, tokenSymbol);

      // Create transfer operation
      const operation = tongoAccount.transfer({
        recipient: recipientTongoPublicKey,
        amount: amount
      });

      // Convert to calldata
      const call = operation.toCalldata();

      // Execute with Starknet signer
      const result = await this.signer.execute(call);

      console.log(`✅ Private transfer successful: ${result.transaction_hash}`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        operation: 'transfer',
        token: tokenSymbol,
        recipient: recipientTongoPublicKey,
        amount_encrypted: true,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'Private transfer completed with hidden amount'
      };

    } catch (error) {
      console.error('Error executing private transfer:', error);
      throw error;
    }
  }

  /**
   * Rollover operation - Move Pending Balance to Current Balance
   * Required after receiving transfers to use the funds
   * 
   * @param {string} userTongoPrivateKey - User's Tongo private key
   * @param {string} tokenSymbol - Token symbol (STRK, ETH, USDC)
   * @returns {Promise<Object>} Transaction result
   */
  async rollover(userTongoPrivateKey, tokenSymbol) {
    try {
      await this.ensureInitialized();

      console.log(`🔄 Rolling over pending ${tokenSymbol} balance to current balance...`);

      const tongoAccount = this.createTongoAccount(userTongoPrivateKey, tokenSymbol);

      // Create rollover operation
      const operation = tongoAccount.rollover();

      // Convert to calldata
      const call = operation.toCalldata();

      // Execute with Starknet signer
      const result = await this.signer.execute(call);

      console.log(`✅ Rollover successful: ${result.transaction_hash}`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        operation: 'rollover',
        token: tokenSymbol,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'Pending balance moved to current balance'
      };

    } catch (error) {
      console.error('Error rolling over balance:', error);
      throw error;
    }
  }

  /**
   * Withdraw operation - Convert Tongo tokens back to ERC20
   * Subtracts from Current Balance
   * 
   * @param {string} userTongoPrivateKey - User's Tongo private key
   * @param {string} amount - Amount to withdraw (in wei)
   * @param {string} recipientStarknetAddress - Recipient's Starknet address
   * @param {string} tokenSymbol - Token symbol (STRK, ETH, USDC)
   * @returns {Promise<Object>} Transaction result
   */
  async withdraw(userTongoPrivateKey, amount, recipientStarknetAddress, tokenSymbol) {
    try {
      await this.ensureInitialized();

      console.log(`💸 Withdrawing ${amount} ${tokenSymbol} to ${recipientStarknetAddress.substring(0, 10)}...`);

      const tongoAccount = this.createTongoAccount(userTongoPrivateKey, tokenSymbol);

      // Create withdraw operation
      const operation = tongoAccount.withdraw({
        amount: amount,
        recipient: recipientStarknetAddress
      });

      // Convert to calldata
      const call = operation.toCalldata();

      // Execute with Starknet signer
      const result = await this.signer.execute(call);

      console.log(`✅ Withdraw successful: ${result.transaction_hash}`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        operation: 'withdraw',
        amount,
        token: tokenSymbol,
        recipient: recipientStarknetAddress,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'Tongo tokens converted back to ERC20'
      };

    } catch (error) {
      console.error('Error withdrawing from Tongo account:', error);
      throw error;
    }
  }

  /**
   * Get Tongo public key from private key
   * @param {string} userTongoPrivateKey - User's Tongo private key
   * @param {string} tokenSymbol - Token symbol (STRK, ETH, USDC)
   * @returns {string} Tongo public key
   */
  getTongoPublicKey(userTongoPrivateKey, tokenSymbol = 'STRK') {
    const tongoAccount = this.createTongoAccount(userTongoPrivateKey, tokenSymbol);
    return tongoAccount.publicKey;
  }

  /**
   * Get supported token addresses
   * @returns {Array} List of supported tokens
   */
  getSupportedTokens() {
    return getSupportedTokens(this.network);
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
module.exports = new TongoServiceV2();
