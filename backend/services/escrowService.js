const { Contract, RpcProvider, Account, cairo, uint256 } = require('starknet');
const crypto = require('crypto');
require('dotenv').config();

// Load Escrow ABI
const ESCROW_ABI = require('../contracts/EscrowABI.json').abi;

// Contract address from environment
const ESCROW_CONTRACT_ADDRESS = process.env.ESCROW_CONTRACT_ADDRESS || '0x0';

// Initialize Starknet provider
const provider = new RpcProvider({
  nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io'
});

/**
 * Escrow Service - TIER 2
 * Handles escrow payment requests, accept/reject, and refunds
 */
class EscrowService {
  constructor() {
    this.provider = provider;
    this.escrowContract = null;
    this.initializeContract();
  }

  /**
   * Initialize escrow smart contract
   */
  initializeContract() {
    try {
      if (ESCROW_CONTRACT_ADDRESS !== '0x0') {
        this.escrowContract = new Contract(ESCROW_ABI, ESCROW_CONTRACT_ADDRESS, this.provider);
        console.log('✅ Escrow contract initialized:', ESCROW_CONTRACT_ADDRESS);
      } else {
        console.warn('⚠️  Escrow contract address not set. Set ESCROW_CONTRACT_ADDRESS in .env');
      }
    } catch (error) {
      console.error('⚠️  Error initializing escrow contract:', error.message);
    }
  }

  /**
   * Check if escrow contract is initialized
   */
  isContractInitialized() {
    return this.escrowContract !== null && ESCROW_CONTRACT_ADDRESS !== '0x0';
  }

  /**
   * Create escrow payment request
   * @param {Object} params - Request parameters
   * @returns {Promise<Object>} Transaction data for frontend signing
   */
  async createEscrowRequest({ 
    fromAddress, 
    toAddress, 
    amount, 
    asset, 
    expiryHours = 24, 
    memo = '' 
  }) {
    try {
      console.log(`📨 Creating escrow request: ${amount} ${asset} from ${fromAddress} to ${toAddress}`);

      if (!this.isContractInitialized()) {
        throw new Error('Escrow contract not initialized. Deploy contract and set ESCROW_CONTRACT_ADDRESS');
      }

      // Validate addresses
      if (!this.isValidStarknetAddress(fromAddress) || !this.isValidStarknetAddress(toAddress)) {
        throw new Error('Invalid Starknet address format');
      }

      // Get token contract address
      const tokenAddress = this.getTokenAddress(asset);

      // Generate request ID (will be replaced by on-chain ID)
      const requestId = `escrow_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      // Calculate expiry timestamp
      const expiryTimestamp = Math.floor(Date.now() / 1000) + (expiryHours * 3600);

      // Prepare transaction data for frontend signing
      const transactionData = {
        contract_address: ESCROW_CONTRACT_ADDRESS,
        entry_point: 'create_payment_request',
        calldata: {
          sender: fromAddress,
          recipient: toAddress,
          amount: amount,
          token: tokenAddress,
          expiry_hours: expiryHours,
          memo: memo || ''
        }
      };

      return {
        success: true,
        request_id: requestId,
        transaction_data: transactionData,
        from_address: fromAddress,
        to_address: toAddress,
        amount,
        asset,
        token_address: tokenAddress,
        expiry_hours: expiryHours,
        expiry_timestamp: expiryTimestamp,
        memo,
        requires_signature: true,
        instructions: 'Sign this transaction to create escrow payment request on-chain'
      };
    } catch (error) {
      console.error('❌ Create escrow request failed:', error);
      throw new Error(`Create escrow request failed: ${error.message}`);
    }
  }

  /**
   * Accept escrow payment request
   * @param {string} requestId - Payment request ID
   * @param {string} recipientAddress - Recipient address
   * @returns {Promise<Object>} Transaction data for frontend signing
   */
  async acceptPaymentRequest(requestId, recipientAddress) {
    try {
      console.log(`✅ Accepting payment request: ${requestId} by ${recipientAddress}`);

      if (!this.isContractInitialized()) {
        throw new Error('Escrow contract not initialized');
      }

      // Prepare transaction data for frontend signing
      const transactionData = {
        contract_address: ESCROW_CONTRACT_ADDRESS,
        entry_point: 'accept_payment',
        calldata: {
          request_id: requestId
        }
      };

      return {
        success: true,
        request_id: requestId,
        action: 'accept',
        transaction_data: transactionData,
        recipient: recipientAddress,
        requires_signature: true,
        instructions: 'Sign this transaction to accept the payment and release funds'
      };
    } catch (error) {
      console.error('❌ Accept payment failed:', error);
      throw new Error(`Accept payment failed: ${error.message}`);
    }
  }

  /**
   * Reject escrow payment request
   * @param {string} requestId - Payment request ID
   * @param {string} recipientAddress - Recipient address
   * @returns {Promise<Object>} Transaction data for frontend signing
   */
  async rejectPaymentRequest(requestId, recipientAddress) {
    try {
      console.log(`❌ Rejecting payment request: ${requestId} by ${recipientAddress}`);

      if (!this.isContractInitialized()) {
        throw new Error('Escrow contract not initialized');
      }

      // Prepare transaction data for frontend signing
      const transactionData = {
        contract_address: ESCROW_CONTRACT_ADDRESS,
        entry_point: 'reject_payment',
        calldata: {
          request_id: requestId
        }
      };

      return {
        success: true,
        request_id: requestId,
        action: 'reject',
        transaction_data: transactionData,
        recipient: recipientAddress,
        requires_signature: true,
        instructions: 'Sign this transaction to reject the payment and refund sender'
      };
    } catch (error) {
      console.error('❌ Reject payment failed:', error);
      throw new Error(`Reject payment failed: ${error.message}`);
    }
  }

  /**
   * Cancel escrow payment request (by sender)
   * @param {string} requestId - Payment request ID
   * @param {string} senderAddress - Sender address
   * @returns {Promise<Object>} Transaction data for frontend signing
   */
  async cancelPaymentRequest(requestId, senderAddress) {
    try {
      console.log(`🚫 Canceling payment request: ${requestId} by ${senderAddress}`);

      if (!this.isContractInitialized()) {
        throw new Error('Escrow contract not initialized');
      }

      // Prepare transaction data for frontend signing
      const transactionData = {
        contract_address: ESCROW_CONTRACT_ADDRESS,
        entry_point: 'cancel_request',
        calldata: {
          request_id: requestId
        }
      };

      return {
        success: true,
        request_id: requestId,
        action: 'cancel',
        transaction_data: transactionData,
        sender: senderAddress,
        requires_signature: true,
        instructions: 'Sign this transaction to cancel the payment request'
      };
    } catch (error) {
      console.error('❌ Cancel payment failed:', error);
      throw new Error(`Cancel payment failed: ${error.message}`);
    }
  }

  /**
   * Get payment request details from blockchain
   * @param {string} requestId - Payment request ID
   * @returns {Promise<Object>} Payment request details
   */
  async getPaymentRequest(requestId) {
    try {
      if (!this.isContractInitialized()) {
        throw new Error('Escrow contract not initialized');
      }

      console.log(`🔍 Fetching payment request: ${requestId}`);

      // Convert request ID to uint256
      const requestIdUint256 = uint256.bnToUint256(BigInt(requestId));

      // Call contract to get request details
      const result = await this.escrowContract.get_payment_request(requestIdUint256);

      // Parse the result
      // Result format: [sender, recipient, amount, token, expiry, status, memo]
      const request = {
        request_id: requestId,
        sender: result[0],
        recipient: result[1],
        amount: this.formatAmount(result[2]),
        token: result[3],
        expiry: Number(result[4]),
        status: this.parseStatus(result[5]),
        memo: result[6] || '',
        created_at: new Date().toISOString(), // Approximate
        expires_at: new Date(Number(result[4]) * 1000).toISOString()
      };

      return request;
    } catch (error) {
      console.error('Error getting payment request:', error);
      throw new Error(`Failed to get payment request: ${error.message}`);
    }
  }

  /**
   * Get all payment requests for a user
   * @param {string} userAddress - User's wallet address
   * @param {string} type - 'sent' or 'received'
   * @returns {Promise<Array>} Array of payment requests
   */
  async getUserRequests(userAddress, type = 'all') {
    try {
      if (!this.isContractInitialized()) {
        throw new Error('Escrow contract not initialized');
      }

      console.log(`🔍 Fetching ${type} requests for: ${userAddress}`);

      // Call contract to get user's request IDs
      const requestIds = await this.escrowContract.get_user_requests(userAddress);

      // Fetch details for each request
      const requests = await Promise.all(
        requestIds.map(id => this.getPaymentRequest(id.toString()))
      );

      // Filter by type if specified
      if (type === 'sent') {
        return requests.filter(r => r.sender.toLowerCase() === userAddress.toLowerCase());
      } else if (type === 'received') {
        return requests.filter(r => r.recipient.toLowerCase() === userAddress.toLowerCase());
      }

      return requests;
    } catch (error) {
      console.error('Error getting user requests:', error);
      // Return empty array if contract not deployed yet
      if (error.message.includes('not initialized')) {
        return [];
      }
      throw new Error(`Failed to get user requests: ${error.message}`);
    }
  }

  /**
   * Get pending payment requests for a user
   * @param {string} userAddress - User's wallet address
   * @returns {Promise<Array>} Array of pending requests
   */
  async getPendingRequests(userAddress) {
    try {
      const allRequests = await this.getUserRequests(userAddress);
      return allRequests.filter(r => r.status === 'pending');
    } catch (error) {
      console.error('Error getting pending requests:', error);
      return [];
    }
  }

  /**
   * Check if payment request is expired
   * @param {string} requestId - Payment request ID
   * @returns {Promise<boolean>} True if expired
   */
  async isRequestExpired(requestId) {
    try {
      const request = await this.getPaymentRequest(requestId);
      const now = Math.floor(Date.now() / 1000);
      return now > request.expiry;
    } catch (error) {
      console.error('Error checking expiry:', error);
      return false;
    }
  }

  /**
   * Get token contract address by symbol
   * @param {string} asset - Asset symbol
   * @returns {string} Token contract address
   */
  getTokenAddress(asset) {
    const addresses = {
      'ENGI': process.env.ENGI_TOKEN_CONTRACT_ADDRESS || '0x0',
      'ETH': '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
      'STRK': '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      'USDC': '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'
    };

    return addresses[asset.toUpperCase()] || addresses['ENGI'];
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
   * Parse status code to string
   * @param {number} statusCode - Status code from contract
   * @returns {string} Status string
   */
  parseStatus(statusCode) {
    const statuses = {
      0: 'pending',
      1: 'accepted',
      2: 'rejected',
      3: 'cancelled',
      4: 'expired'
    };
    return statuses[statusCode] || 'unknown';
  }

  /**
   * Format amount from uint256
   * @param {Object} amount - uint256 amount
   * @returns {string} Formatted amount
   */
  formatAmount(amount) {
    try {
      const amountBN = uint256.uint256ToBN(amount);
      const amountStr = amountBN.toString();
      // Assuming 18 decimals
      const decimals = 18;
      const str = amountStr.padStart(decimals + 1, '0');
      const integer = str.slice(0, -decimals) || '0';
      const fraction = str.slice(-decimals).replace(/0+$/, '');
      return fraction ? `${integer}.${fraction}` : integer;
    } catch (error) {
      console.error('Error formatting amount:', error);
      return '0';
    }
  }

  /**
   * Parse amount to uint256
   * @param {string} amount - Amount string
   * @returns {Object} uint256 amount
   */
  parseAmount(amount) {
    try {
      const decimals = 18;
      const [integer, fraction = ''] = amount.split('.');
      const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
      const amountBN = BigInt(integer + paddedFraction);
      return uint256.bnToUint256(amountBN);
    } catch (error) {
      console.error('Error parsing amount:', error);
      return uint256.bnToUint256(0n);
    }
  }

  /**
   * Generate payment link for request
   * @param {string} requestId - Request ID
   * @returns {string} Payment link
   */
  generatePaymentLink(requestId) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    return `${frontendUrl}/pay/${requestId}`;
  }

  /**
   * Generate QR code data for request
   * @param {Object} request - Request details
   * @returns {string} QR code data (JSON string)
   */
  generateQRCodeData(request) {
    return JSON.stringify({
      type: 'escrow_payment_request',
      request_id: request.request_id,
      amount: request.amount,
      asset: request.asset,
      recipient: request.to_address,
      sender: request.from_address,
      expires_at: request.expiry_timestamp,
      contract_address: ESCROW_CONTRACT_ADDRESS
    });
  }
}

// Export singleton instance
module.exports = new EscrowService();
