const { Contract, RpcProvider, Account, cairo, uint256 } = require('starknet');
const crypto = require('crypto');
require('dotenv').config();

// Load ABIs
const ENGI_TOKEN_ABI = require('../contracts/EngiTokenABI.json').abi;
const ESCROW_ABI = require('../contracts/EscrowABI.json').abi;

// Contract addresses from environment
const ENGI_TOKEN_ADDRESS = process.env.ENGI_TOKEN_CONTRACT_ADDRESS || '0x0';
const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || '0x0';

// Initialize Starknet provider
const provider = new RpcProvider({
  nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io'
});

class PaymentService {
  constructor() {
    this.provider = provider;
    this.engiTokenContract = null;
    this.escrowContract = null;
    this.initializeContracts();
  }

  /**
   * Initialize smart contracts
   */
  initializeContracts() {
    try {
      if (ENGI_TOKEN_ADDRESS !== '0x0') {
        this.engiTokenContract = new Contract(ENGI_TOKEN_ABI, ENGI_TOKEN_ADDRESS, this.provider);
        console.log('✅ ENGI Token contract initialized');
      }

      if (ESCROW_CONTRACT_ADDRESS !== '0x0') {
        this.escrowContract = new Contract(ESCROW_ABI, ESCROW_CONTRACT_ADDRESS, this.provider);
        console.log('✅ Escrow contract initialized');
      }
    } catch (error) {
      console.error('⚠️  Error initializing contracts:', error.message);
    }
  }

  /**
   * Send payment - Direct token transfer
   * @param {Object} params - Payment parameters
   * @returns {Promise<Object>} Transaction result
   */
  async sendPayment({ fromAddress, toAddress, amount, asset, memo, userAccount }) {
    try {
      console.log(`💸 Initiating payment: ${fromAddress} -> ${toAddress}, ${amount} ${asset}`);

      // Validate addresses
      if (!this.isValidStarknetAddress(fromAddress) || !this.isValidStarknetAddress(toAddress)) {
        throw new Error('Invalid Starknet address format');
      }

      let txHash = null;
      let contractAddress = null;

      // Determine which token to transfer
      switch (asset.toUpperCase()) {
        case 'ENGI':
          if (!this.engiTokenContract) {
            throw new Error('ENGI token contract not initialized');
          }
          contractAddress = ENGI_TOKEN_ADDRESS;
          txHash = await this.transferENGI(toAddress, amount, userAccount);
          break;

        case 'ETH':
          // ETH transfer on Starknet
          contractAddress = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'; // ETH on Starknet
          txHash = await this.transferETH(toAddress, amount, userAccount);
          break;

        case 'STRK':
          // STRK transfer
          contractAddress = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'; // STRK token
          txHash = await this.transferToken(contractAddress, toAddress, amount, userAccount);
          break;

        case 'USDC':
          // USDC on Starknet
          contractAddress = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'; // USDC on Starknet
          txHash = await this.transferToken(contractAddress, toAddress, amount, userAccount);
          break;

        default:
          throw new Error(`Unsupported asset: ${asset}`);
      }

      // Wait for transaction confirmation
      console.log(`⏳ Waiting for transaction confirmation: ${txHash}`);
      const receipt = await this.provider.waitForTransaction(txHash);

      return {
        success: true,
        tx_hash: txHash,
        status: receipt.status === 'ACCEPTED_ON_L2' ? 'confirmed' : 'pending',
        block_number: receipt.block_number,
        from: fromAddress,
        to: toAddress,
        amount,
        asset,
        memo,
        contract_address: contractAddress,
        explorer_url: `https://starkscan.co/tx/${txHash}`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Payment failed:', error);
      throw new Error(`Payment failed: ${error.message}`);
    }
  }

  /**
   * Transfer ENGI tokens
   * @param {string} toAddress - Recipient address
   * @param {string} amount - Amount to transfer
   * @param {Account} userAccount - User's Starknet account
   * @returns {Promise<string>} Transaction hash
   */
  async transferENGI(toAddress, amount, userAccount) {
    try {
      // Convert amount to uint256 (18 decimals for ENGI)
      const amountInWei = this.parseUnits(amount, 18);
      const amountUint256 = uint256.bnToUint256(amountInWei);

      // Connect contract with user account
      this.engiTokenContract.connect(userAccount);

      // Execute transfer
      const call = this.engiTokenContract.populate('transfer', [toAddress, amountUint256]);
      const tx = await userAccount.execute(call);

      return tx.transaction_hash;
    } catch (error) {
      console.error('Error transferring ENGI:', error);
      throw error;
    }
  }

  /**
   * Transfer ETH on Starknet
   * @param {string} toAddress - Recipient address
   * @param {string} amount - Amount to transfer
   * @param {Account} userAccount - User's Starknet account
   * @returns {Promise<string>} Transaction hash
   */
  async transferETH(toAddress, amount, userAccount) {
    try {
      const ethContractAddress = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7';
      return await this.transferToken(ethContractAddress, toAddress, amount, userAccount);
    } catch (error) {
      console.error('Error transferring ETH:', error);
      throw error;
    }
  }

  /**
   * Transfer any ERC20 token on Starknet
   * @param {string} tokenAddress - Token contract address
   * @param {string} toAddress - Recipient address
   * @param {string} amount - Amount to transfer
   * @param {Account} userAccount - User's Starknet account
   * @returns {Promise<string>} Transaction hash
   */
  async transferToken(tokenAddress, toAddress, amount, userAccount) {
    try {
      // Standard ERC20 ABI for transfer
      const erc20ABI = [
        {
          name: 'transfer',
          type: 'function',
          inputs: [
            { name: 'recipient', type: 'core::starknet::contract_address::ContractAddress' },
            { name: 'amount', type: 'core::integer::u256' }
          ],
          outputs: [{ type: 'core::bool' }],
          state_mutability: 'external'
        }
      ];

      const tokenContract = new Contract(erc20ABI, tokenAddress, this.provider);
      tokenContract.connect(userAccount);

      // Convert amount to uint256 (18 decimals)
      const amountInWei = this.parseUnits(amount, 18);
      const amountUint256 = uint256.bnToUint256(amountInWei);

      // Execute transfer
      const call = tokenContract.populate('transfer', [toAddress, amountUint256]);
      const tx = await userAccount.execute(call);

      return tx.transaction_hash;
    } catch (error) {
      console.error('Error transferring token:', error);
      throw error;
    }
  }

  /**
   * Create payment request using Escrow contract
   * @param {Object} params - Payment request parameters
   * @returns {Promise<Object>} Payment request result
   */
  async createPaymentRequest({ fromAddress, amount, asset, expiryHours, memo, userAccount }) {
    try {
      console.log(`📨 Creating payment request: ${amount} ${asset} from ${fromAddress}`);

      if (!this.escrowContract) {
        throw new Error('Escrow contract not initialized');
      }

      // Get token contract address
      const tokenAddress = this.getTokenAddress(asset);

      // Convert amount to uint256
      const amountInWei = this.parseUnits(amount, 18);
      const amountUint256 = uint256.bnToUint256(amountInWei);

      // Convert memo to felt252
      const memoFelt = cairo.felt(memo || '');

      // Connect contract with user account
      this.escrowContract.connect(userAccount);

      // Create payment request on-chain
      const call = this.escrowContract.populate('create_payment_request', [
        fromAddress, // recipient (who will receive the payment)
        amountUint256,
        tokenAddress,
        expiryHours,
        memoFelt
      ]);

      const tx = await userAccount.execute(call);
      const receipt = await this.provider.waitForTransaction(tx.transaction_hash);

      // Extract request_id from events
      const requestId = this.extractRequestIdFromReceipt(receipt);

      return {
        success: true,
        request_id: requestId || `req_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        tx_hash: tx.transaction_hash,
        status: 'active',
        from_address: fromAddress,
        amount,
        asset,
        expiry_hours: expiryHours,
        memo,
        contract_address: ESCROW_CONTRACT_ADDRESS,
        explorer_url: `https://starkscan.co/tx/${tx.transaction_hash}`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Create payment request failed:', error);
      throw new Error(`Create payment request failed: ${error.message}`);
    }
  }

  /**
   * Accept payment request
   * @param {string} requestId - Payment request ID
   * @param {Account} userAccount - User's Starknet account
   * @returns {Promise<Object>} Transaction result
   */
  async acceptPaymentRequest(requestId, userAccount) {
    try {
      if (!this.escrowContract) {
        throw new Error('Escrow contract not initialized');
      }

      this.escrowContract.connect(userAccount);

      const requestIdUint256 = uint256.bnToUint256(BigInt(requestId));
      const call = this.escrowContract.populate('accept_payment', [requestIdUint256]);
      const tx = await userAccount.execute(call);

      const receipt = await this.provider.waitForTransaction(tx.transaction_hash);

      return {
        success: true,
        tx_hash: tx.transaction_hash,
        status: receipt.status === 'ACCEPTED_ON_L2' ? 'accepted' : 'pending',
        request_id: requestId,
        explorer_url: `https://starkscan.co/tx/${tx.transaction_hash}`,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Accept payment failed:', error);
      throw new Error(`Accept payment failed: ${error.message}`);
    }
  }

  /**
   * Get payment request details from blockchain
   * @param {string} requestId - Payment request ID
   * @returns {Promise<Object>} Payment request details
   */
  async getPaymentRequest(requestId) {
    try {
      if (!this.escrowContract) {
        throw new Error('Escrow contract not initialized');
      }

      const requestIdUint256 = uint256.bnToUint256(BigInt(requestId));
      const result = await this.escrowContract.get_payment_request(requestIdUint256);

      // Parse the result array
      return {
        request_id: requestId,
        sender: result[0],
        recipient: result[1],
        amount: result[2],
        token: result[3],
        expiry: result[4],
        status: result[5],
        memo: result[6]
      };
    } catch (error) {
      console.error('Error getting payment request:', error);
      throw error;
    }
  }

  /**
   * Get token balance
   * @param {string} address - Wallet address
   * @param {string} asset - Asset symbol
   * @returns {Promise<string>} Balance
   */
  async getBalance(address, asset) {
    try {
      const tokenAddress = this.getTokenAddress(asset);
      
      const erc20ABI = [
        {
          name: 'balance_of',
          type: 'function',
          inputs: [{ name: 'account', type: 'core::starknet::contract_address::ContractAddress' }],
          outputs: [{ type: 'core::integer::u256' }],
          state_mutability: 'view'
        }
      ];

      const tokenContract = new Contract(erc20ABI, tokenAddress, this.provider);
      const balance = await tokenContract.balance_of(address);

      // Convert uint256 to string
      const balanceStr = uint256.uint256ToBN(balance).toString();
      return this.formatUnits(balanceStr, 18);
    } catch (error) {
      console.error('Error getting balance:', error);
      return '0';
    }
  }

  /**
   * Get token contract address by symbol
   * @param {string} asset - Asset symbol
   * @returns {string} Token contract address
   */
  getTokenAddress(asset) {
    const addresses = {
      'ENGI': ENGI_TOKEN_ADDRESS,
      'ETH': '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
      'STRK': '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      'USDC': '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'
    };

    return addresses[asset.toUpperCase()] || ENGI_TOKEN_ADDRESS;
  }

  /**
   * Validate Starknet address
   * @param {string} address - Address to validate
   * @returns {boolean} Is valid
   */
  isValidStarknetAddress(address) {
    return /^0x[0-9a-fA-F]{1,64}$/.test(address);
  }

  /**
   * Parse units (convert decimal to wei)
   * @param {string} value - Value in decimal
   * @param {number} decimals - Token decimals
   * @returns {BigInt} Value in wei
   */
  parseUnits(value, decimals) {
    const [integer, fraction = ''] = value.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(integer + paddedFraction);
  }

  /**
   * Format units (convert wei to decimal)
   * @param {string} value - Value in wei
   * @param {number} decimals - Token decimals
   * @returns {string} Value in decimal
   */
  formatUnits(value, decimals) {
    const str = value.padStart(decimals + 1, '0');
    const integer = str.slice(0, -decimals) || '0';
    const fraction = str.slice(-decimals).replace(/0+$/, '');
    return fraction ? `${integer}.${fraction}` : integer;
  }

  /**
   * Extract request ID from transaction receipt
   * @param {Object} receipt - Transaction receipt
   * @returns {string|null} Request ID
   */
  extractRequestIdFromReceipt(receipt) {
    try {
      // Look for PaymentRequestCreated event
      const events = receipt.events || [];
      for (const event of events) {
        if (event.keys && event.keys[0] === 'PaymentRequestCreated') {
          return event.data[0]; // First data field is request_id
        }
      }
      return null;
    } catch (error) {
      console.error('Error extracting request ID:', error);
      return null;
    }
  }
}

// Export singleton instance
module.exports = new PaymentService();
