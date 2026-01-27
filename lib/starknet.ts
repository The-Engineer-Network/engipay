// StarkNet Contract Integration
import { Contract, Account, Provider, CallData, cairo } from 'starknet';

// Contract ABIs
import EngiTokenABI from '../smart-contracts/contracts/EngiTokenABI.json';
import EscrowABI from '../smart-contracts/contracts/EscrowABI.json';
import RewardDistributorABI from '../smart-contracts/contracts/RewardDistributorABI.json';

// Contract Addresses
const CONTRACT_ADDRESSES = {
  engiToken: process.env.ENGI_TOKEN_CONTRACT || '0x0',
  escrow: process.env.ESCROW_CONTRACT || '0x0',
  rewardDistributor: process.env.REWARD_DISTRIBUTOR_CONTRACT || '0x0',
};

// Provider setup
const provider = new Provider({
  rpc: {
    nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io',
  },
});

// Contract instances
export const contracts = {
  engiToken: new Contract(EngiTokenABI.abi, CONTRACT_ADDRESSES.engiToken, provider),
  escrow: new Contract(EscrowABI.abi, CONTRACT_ADDRESSES.escrow, provider),
  rewardDistributor: new Contract(RewardDistributorABI.abi, CONTRACT_ADDRESSES.rewardDistributor, provider),
};

// EngiToken Contract Functions
export class EngiTokenService {
  private contract = contracts.engiToken;

  async getBalance(address: string): Promise<string> {
    try {
      const result = await this.contract.balance_of(address);
      return result.toString();
    } catch (error) {
      console.error('Error getting EngiToken balance:', error);
      throw error;
    }
  }

  async transfer(recipient: string, amount: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.transfer(recipient, cairo.uint256(amount));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error transferring EngiToken:', error);
      throw error;
    }
  }

  async stake(amount: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.stake(cairo.uint256(amount));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error staking EngiToken:', error);
      throw error;
    }
  }

  async unstake(amount: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.unstake(cairo.uint256(amount));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error unstaking EngiToken:', error);
      throw error;
    }
  }

  async claimRewards(signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.claim_rewards();
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error claiming rewards:', error);
      throw error;
    }
  }

  async getStakedBalance(address: string): Promise<string> {
    try {
      const result = await this.contract.get_staked_balance(address);
      return result.toString();
    } catch (error) {
      console.error('Error getting staked balance:', error);
      throw error;
    }
  }

  async getPendingRewards(address: string): Promise<string> {
    try {
      const result = await this.contract.get_pending_rewards(address);
      return result.toString();
    } catch (error) {
      console.error('Error getting pending rewards:', error);
      throw error;
    }
  }
}

// Escrow Contract Functions
export class EscrowService {
  private contract = contracts.escrow;

  async createPaymentRequest(
    recipient: string,
    amount: string,
    tokenAddress: string,
    expiryHours: number,
    memo: string,
    signer: Account
  ): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.create_payment_request(
        recipient,
        cairo.uint256(amount),
        tokenAddress,
        expiryHours,
        memo
      );
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error creating payment request:', error);
      throw error;
    }
  }

  async acceptPayment(requestId: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.accept_payment(cairo.uint256(requestId));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error accepting payment:', error);
      throw error;
    }
  }

  async rejectPayment(requestId: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.reject_payment(cairo.uint256(requestId));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error rejecting payment:', error);
      throw error;
    }
  }

  async cancelPayment(requestId: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.cancel_payment(cairo.uint256(requestId));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error canceling payment:', error);
      throw error;
    }
  }

  async getPaymentRequest(requestId: string): Promise<any> {
    try {
      const result = await this.contract.get_payment_request(cairo.uint256(requestId));
      return result;
    } catch (error) {
      console.error('Error getting payment request:', error);
      throw error;
    }
  }

  async getPaymentStatus(requestId: string): Promise<number> {
    try {
      const result = await this.contract.get_payment_status(cairo.uint256(requestId));
      return Number(result);
    } catch (error) {
      console.error('Error getting payment status:', error);
      throw error;
    }
  }
}

// Reward Distributor Contract Functions
export class RewardDistributorService {
  private contract = contracts.rewardDistributor;

  async stake(poolId: string, amount: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.stake(cairo.uint256(poolId), cairo.uint256(amount));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error staking in reward pool:', error);
      throw error;
    }
  }

  async unstake(poolId: string, amount: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.unstake(cairo.uint256(poolId), cairo.uint256(amount));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error unstaking from reward pool:', error);
      throw error;
    }
  }

  async claimRewards(poolId: string, signer: Account): Promise<string> {
    try {
      this.contract.connect(signer);
      const result = await this.contract.claim_rewards(cairo.uint256(poolId));
      await provider.waitForTransaction(result.transaction_hash);
      return result.transaction_hash;
    } catch (error) {
      console.error('Error claiming rewards:', error);
      throw error;
    }
  }

  async getPendingRewards(poolId: string, userAddress: string): Promise<string> {
    try {
      const result = await this.contract.get_pending_rewards(cairo.uint256(poolId), userAddress);
      return result.toString();
    } catch (error) {
      console.error('Error getting pending rewards:', error);
      throw error;
    }
  }

  async getUserStake(poolId: string, userAddress: string): Promise<any> {
    try {
      const result = await this.contract.get_user_stake(cairo.uint256(poolId), userAddress);
      return result;
    } catch (error) {
      console.error('Error getting user stake:', error);
      throw error;
    }
  }

  async getPoolInfo(poolId: string): Promise<any> {
    try {
      const result = await this.contract.get_pool_info(cairo.uint256(poolId));
      return result;
    } catch (error) {
      console.error('Error getting pool info:', error);
      throw error;
    }
  }

  async getTotalPools(): Promise<string> {
    try {
      const result = await this.contract.get_total_pools();
      return result.toString();
    } catch (error) {
      console.error('Error getting total pools:', error);
      throw error;
    }
  }
}

// Service instances
export const engiTokenService = new EngiTokenService();
export const escrowService = new EscrowService();
export const rewardDistributorService = new RewardDistributorService();

// Utility functions
export const getStarknetProvider = () => provider;

export const createStarknetAccount = (address: string, privateKey: string) => {
  return new Account(provider, address, privateKey);
};


// Payment Service for direct transfers
export class PaymentService {
  private provider = provider;

  /**
   * Get token contract address by symbol
   */
  getTokenAddress(asset: string): string {
    const addresses: Record<string, string> = {
      'ENGI': CONTRACT_ADDRESSES.engiToken,
      'ETH': '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7',
      'STRK': '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d',
      'USDC': '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'
    };
    return addresses[asset.toUpperCase()] || CONTRACT_ADDRESSES.engiToken;
  }

  /**
   * Transfer tokens (works with any ERC20 on Starknet)
   */
  async transferToken(
    tokenAddress: string,
    recipient: string,
    amount: string,
    signer: Account
  ): Promise<{ transaction_hash: string }> {
    try {
      // Standard ERC20 transfer
      const transferCall = {
        contractAddress: tokenAddress,
        entrypoint: 'transfer',
        calldata: CallData.compile({
          recipient,
          amount: cairo.uint256(amount)
        })
      };

      const result = await signer.execute(transferCall);
      await this.provider.waitForTransaction(result.transaction_hash);

      return { transaction_hash: result.transaction_hash };
    } catch (error) {
      console.error('Error transferring token:', error);
      throw error;
    }
  }

  /**
   * Send payment (convenience method)
   */
  async sendPayment(
    recipient: string,
    amount: string,
    asset: string,
    signer: Account
  ): Promise<{ transaction_hash: string; explorer_url: string }> {
    try {
      const tokenAddress = this.getTokenAddress(asset);
      const result = await this.transferToken(tokenAddress, recipient, amount, signer);

      return {
        transaction_hash: result.transaction_hash,
        explorer_url: `https://starkscan.co/tx/${result.transaction_hash}`
      };
    } catch (error) {
      console.error('Error sending payment:', error);
      throw error;
    }
  }

  /**
   * Parse amount to wei (18 decimals)
   */
  parseUnits(value: string, decimals: number = 18): string {
    const [integer, fraction = ''] = value.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return integer + paddedFraction;
  }

  /**
   * Format amount from wei to decimal
   */
  formatUnits(value: string, decimals: number = 18): string {
    const str = value.padStart(decimals + 1, '0');
    const integer = str.slice(0, -decimals) || '0';
    const fraction = str.slice(-decimals).replace(/0+$/, '');
    return fraction ? `${integer}.${fraction}` : integer;
  }
}

export const paymentService = new PaymentService();
