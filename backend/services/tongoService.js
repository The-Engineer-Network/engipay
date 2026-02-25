const { TongoClient } = require('@fatsolutions/tongo-sdk');
require('dotenv').config();

/**
 * Tongo Service - Privacy-Shielded Transactions
 * Implements ElGamal encryption for confidential ERC20 payments on StarkNet
 * Based on: https://docs.tongo.cash/
 * 
 * Features:
 * - Hidden transaction amounts using ElGamal encryption
 * - Zero-knowledge proofs over Stark curve
 * - Homomorphic encryption for privacy
 * - Full auditability with viewing keys
 * - No trusted setup required
 */

class TongoService {
  constructor() {
    this.client = null;
    this.initialized = false;
  }

  /**
   * Initialize Tongo SDK
   */
  async initialize() {
    try {
      if (this.initialized) {
        return;
      }

      console.log('Initializing Tongo SDK for privacy-shielded transactions...');

      // Initialize Tongo client with StarkNet RPC
      this.client = new TongoClient({
        rpcUrl: process.env.STARKNET_RPC_URL || 'https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_7/Dij4b08u9UCGvFQ6sfgDP',
        network: process.env.STARKNET_NETWORK || 'sepolia',
        // Tongo contract addresses (these should be set in .env)
        tongoWrapperContract: process.env.TONGO_WRAPPER_CONTRACT,
        tongoTransferContract: process.env.TONGO_TRANSFER_CONTRACT,
      });

      await this.client.init();

      this.initialized = true;
      console.log('✅ Tongo SDK initialized successfully');

    } catch (error) {
      console.error('❌ Failed to initialize Tongo SDK:', error);
      throw error;
    }
  }

  /**
   * Shield (wrap) ERC20 tokens with encryption
   * Converts public ERC20 tokens into encrypted Tongo tokens
   * 
   * @param {string} tokenAddress - ERC20 token contract address
   * @param {string} amount - Amount to shield (in wei)
   * @param {Object} signer - StarkNet account/signer
   * @returns {Promise<Object>} Shield transaction result
   */
  async shieldDeposit(tokenAddress, amount, signer) {
    try {
      await this.ensureInitialized();

      console.log(`🛡️ Shielding ${amount} tokens at ${tokenAddress}...`);

      // Wrap ERC20 tokens with ElGamal encryption
      const result = await this.client.shield({
        tokenAddress,
        amount: BigInt(amount),
        signer,
      });

      console.log(`✅ Tokens shielded successfully. Encrypted balance created.`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        encrypted_balance: result.encrypted_balance,
        public_key: result.public_key,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'Tokens wrapped with encryption successfully'
      };

    } catch (error) {
      console.error('Error shielding tokens:', error);
      throw error;
    }
  }

  /**
   * Private transfer with hidden amounts
   * Transfers encrypted tokens without revealing the amount
   * 
   * @param {string} tokenAddress - Tongo-wrapped token address
   * @param {string} recipient - Recipient's StarkNet address
   * @param {string} amount - Amount to transfer (encrypted)
   * @param {Object} signer - StarkNet account/signer
   * @param {string} memo - Optional encrypted memo
   * @returns {Promise<Object>} Private transfer result
   */
  async privateTransfer(tokenAddress, recipient, amount, signer, memo = '') {
    try {
      await this.ensureInitialized();

      console.log(`🔒 Initiating private transfer to ${recipient}...`);

      // Execute private transfer with ElGamal encryption
      const result = await this.client.privateTransfer({
        tokenAddress,
        recipient,
        amount: BigInt(amount),
        signer,
        memo,
      });

      console.log(`✅ Private transfer completed. Amount hidden via encryption.`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        encrypted_amount: result.encrypted_amount,
        recipient,
        proof: result.zero_knowledge_proof,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'Private transfer completed with hidden amount'
      };

    } catch (error) {
      console.error('Error executing private transfer:', error);
      throw error;
    }
  }

  /**
   * Unshield (unwrap) encrypted tokens back to ERC20
   * Converts Tongo encrypted tokens back to public ERC20 tokens
   * 
   * @param {string} tokenAddress - Tongo-wrapped token address
   * @param {string} amount - Amount to unshield (in wei)
   * @param {Object} signer - StarkNet account/signer
   * @returns {Promise<Object>} Unshield transaction result
   */
  async unshieldWithdraw(tokenAddress, amount, signer) {
    try {
      await this.ensureInitialized();

      console.log(`🔓 Unshielding ${amount} tokens...`);

      // Unwrap encrypted tokens back to ERC20
      const result = await this.client.unshield({
        tokenAddress,
        amount: BigInt(amount),
        signer,
      });

      console.log(`✅ Tokens unshielded successfully. Public ERC20 balance restored.`);

      return {
        success: true,
        tx_hash: result.transaction_hash,
        amount,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`,
        message: 'Tokens unwrapped to ERC20 successfully'
      };

    } catch (error) {
      console.error('Error unshielding tokens:', error);
      throw error;
    }
  }

  /**
   * Generate viewing key for auditing
   * Creates a key that allows viewing encrypted transaction amounts
   * 
   * @param {Object} signer - StarkNet account/signer
   * @returns {Promise<Object>} Viewing key details
   */
  async generateViewingKey(signer) {
    try {
      await this.ensureInitialized();

      console.log('🔑 Generating viewing key for transaction auditing...');

      const viewingKey = await this.client.generateViewingKey({
        signer,
      });

      console.log('✅ Viewing key generated successfully');

      return {
        success: true,
        viewing_key: viewingKey.key,
        public_key: viewingKey.public_key,
        expires_at: viewingKey.expires_at,
        message: 'Viewing key can be shared with auditors to reveal transaction amounts'
      };

    } catch (error) {
      console.error('Error generating viewing key:', error);
      throw error;
    }
  }

  /**
   * Get encrypted balance
   * Retrieves the encrypted balance for a user
   * 
   * @param {string} address - User's StarkNet address
   * @param {string} tokenAddress - Tongo-wrapped token address
   * @returns {Promise<Object>} Encrypted balance details
   */
  async getEncryptedBalance(address, tokenAddress) {
    try {
      await this.ensureInitialized();

      const balance = await this.client.getEncryptedBalance({
        address,
        tokenAddress,
      });

      return {
        success: true,
        address,
        token: tokenAddress,
        encrypted_balance: balance.encrypted_value,
        public_key: balance.public_key,
        message: 'Balance is encrypted. Use viewing key to decrypt.'
      };

    } catch (error) {
      console.error('Error getting encrypted balance:', error);
      throw error;
    }
  }

  /**
   * Decrypt balance with viewing key
   * Reveals the actual balance amount using a viewing key
   * 
   * @param {string} encryptedBalance - Encrypted balance value
   * @param {string} viewingKey - Viewing key for decryption
   * @returns {Promise<Object>} Decrypted balance
   */
  async decryptBalance(encryptedBalance, viewingKey) {
    try {
      await this.ensureInitialized();

      const decrypted = await this.client.decryptBalance({
        encrypted_balance: encryptedBalance,
        viewing_key: viewingKey,
      });

      return {
        success: true,
        decrypted_amount: decrypted.amount.toString(),
        message: 'Balance decrypted successfully'
      };

    } catch (error) {
      console.error('Error decrypting balance:', error);
      throw error;
    }
  }

  /**
   * Get supported tokens for privacy wrapping
   * Returns list of ERC20 tokens that can be wrapped with Tongo
   * 
   * @returns {Promise<Array>} List of supported tokens
   */
  async getSupportedTokens() {
    try {
      await this.ensureInitialized();

      const tokens = await this.client.getSupportedTokens();

      return tokens.map(token => ({
        address: token.address,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        tongo_wrapper: token.wrapper_address,
      }));

    } catch (error) {
      console.error('Error getting supported tokens:', error);
      // Return default tokens if API fails
      return [
        {
          address: '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
          symbol: 'ETH',
          name: 'Ethereum',
          decimals: 18,
          tongo_wrapper: process.env.TONGO_ETH_WRAPPER,
        },
        {
          address: '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
          symbol: 'STRK',
          name: 'StarkNet Token',
          decimals: 18,
          tongo_wrapper: process.env.TONGO_STRK_WRAPPER,
        },
        {
          address: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
          symbol: 'USDC',
          name: 'USD Coin',
          decimals: 6,
          tongo_wrapper: process.env.TONGO_USDC_WRAPPER,
        },
      ];
    }
  }

  /**
   * Verify zero-knowledge proof
   * Validates that a private transaction proof is correct
   * 
   * @param {Object} proof - Zero-knowledge proof to verify
   * @returns {Promise<boolean>} True if proof is valid
   */
  async verifyProof(proof) {
    try {
      await this.ensureInitialized();

      const isValid = await this.client.verifyProof(proof);

      return {
        success: true,
        is_valid: isValid,
        message: isValid ? 'Proof is valid' : 'Proof verification failed'
      };

    } catch (error) {
      console.error('Error verifying proof:', error);
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
module.exports = new TongoService();
