/**
 * Trove Staking Service
 * 
 * Service for interacting with Starknet staking contracts
 * Handles stake, withdraw, claim rewards, and position tracking
 */

const Decimal = require('decimal.js');
const StarknetContractManager = require('./StarknetContractManager');
const { PragmaOracleService } = require('./PragmaOracleService');
const TransactionManager = require('./TransactionManager');
const StakingPosition = require('../models/StakingPosition');
const StakingTransaction = require('../models/StakingTransaction');

/**
 * TroveStakingService
 * 
 * Manages staking operations on Starknet
 */
class TroveStakingService {
  constructor() {
    this.contracts = new StarknetContractManager();
    this.oracle = new PragmaOracleService();
    this.txManager = new TransactionManager(this.contracts.provider);
    
    // Set precision for decimal calculations
    Decimal.set({ precision: 36, rounding: Decimal.ROUND_DOWN });
    
    console.log('TroveStakingService initialized');
  }

  /**
   * Stake tokens in a staking contract
   * 
   * @param {string} userId - User ID
   * @param {string} stakingContractAddress - Staking contract address
   * @param {string} stakingToken - Token symbol to stake
   * @param {string} rewardToken - Reward token symbol
   * @param {string|number|Decimal} amount - Amount to stake
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Stake operation result
   */
  async stake(userId, stakingContractAddress, stakingToken, rewardToken, amount, walletAddress) {
    console.log('TroveStakingService.stake called', {
      userId,
      stakingContractAddress,
      stakingToken,
      rewardToken,
      amount,
      walletAddress
    });

    try {
      // Validate inputs
      this.validateAddress(stakingContractAddress, 'stakingContractAddress');
      this.validateAddress(walletAddress, 'walletAddress');
      const amountDecimal = this.validateAmount(amount, 'amount');

      // Execute stake transaction
      const transactionHash = await this.txManager.executeStake(
        stakingContractAddress,
        amountDecimal.toString(),
        walletAddress
      );

      console.log('Stake transaction submitted', { transactionHash });

      // Find or create staking position
      let position = await StakingPosition.findOne({
        where: {
          user_id: userId,
          staking_contract_address: stakingContractAddress,
          status: 'active'
        }
      });

      if (position) {
        // Update existing position
        const newStakedAmount = new Decimal(position.staked_amount).add(amountDecimal);
        await position.update({
          staked_amount: newStakedAmount.toString(),
          last_updated_at: new Date()
        });
      } else {
        // Create new position
        position = await StakingPosition.create({
          user_id: userId,
          staking_contract_address: stakingContractAddress,
          staking_token: stakingToken,
          reward_token: rewardToken,
          staked_amount: amountDecimal.toString(),
          status: 'active',
          staked_at: new Date(),
          last_updated_at: new Date()
        });
      }

      // Create transaction record
      const transaction = await StakingTransaction.create({
        user_id: userId,
        position_id: position.id,
        transaction_hash: transactionHash,
        type: 'stake',
        status: 'pending',
        amount: amountDecimal.toString(),
        token: stakingToken
      });

      return {
        success: true,
        transactionHash,
        position: {
          id: position.id,
          stakedAmount: position.staked_amount,
          status: position.status
        },
        transaction: {
          id: transaction.id,
          status: transaction.status
        }
      };
    } catch (error) {
      console.error('Error staking tokens:', error);
      throw error;
    }
  }

  /**
   * Withdraw staked tokens
   * 
   * @param {string} userId - User ID
   * @param {string} positionId - Position ID
   * @param {string|number|Decimal} amount - Amount to withdraw
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Withdraw operation result
   */
  async withdraw(userId, positionId, amount, walletAddress) {
    console.log('TroveStakingService.withdraw called', {
      userId,
      positionId,
      amount,
      walletAddress
    });

    try {
      // Get position
      const position = await StakingPosition.findOne({
        where: {
          id: positionId,
          user_id: userId,
          status: 'active'
        }
      });

      if (!position) {
        throw new Error('Position not found or not active');
      }

      // Validate amount
      const amountDecimal = this.validateAmount(amount, 'amount');
      const stakedAmount = new Decimal(position.staked_amount);

      if (amountDecimal.gt(stakedAmount)) {
        throw new Error('Withdrawal amount exceeds staked amount');
      }

      // Execute withdraw transaction
      const transactionHash = await this.txManager.executeWithdraw(
        position.staking_contract_address,
        amountDecimal.toString(),
        walletAddress
      );

      console.log('Withdraw transaction submitted', { transactionHash });

      // Update position
      const newStakedAmount = stakedAmount.sub(amountDecimal);
      const newStatus = newStakedAmount.isZero() ? 'withdrawn' : 'partial';

      await position.update({
        staked_amount: newStakedAmount.toString(),
        status: newStatus,
        withdrawn_at: newStatus === 'withdrawn' ? new Date() : null,
        last_updated_at: new Date()
      });

      // Create transaction record
      const transaction = await StakingTransaction.create({
        user_id: userId,
        position_id: position.id,
        transaction_hash: transactionHash,
        type: 'withdraw',
        status: 'pending',
        amount: amountDecimal.toString(),
        token: position.staking_token
      });

      return {
        success: true,
        transactionHash,
        position: {
          id: position.id,
          stakedAmount: position.staked_amount,
          status: position.status
        },
        transaction: {
          id: transaction.id,
          status: transaction.status
        }
      };
    } catch (error) {
      console.error('Error withdrawing tokens:', error);
      throw error;
    }
  }

  /**
   * Claim accumulated rewards
   * 
   * @param {string} userId - User ID
   * @param {string} positionId - Position ID
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object>} Claim operation result
   */
  async claimRewards(userId, positionId, walletAddress) {
    console.log('TroveStakingService.claimRewards called', {
      userId,
      positionId,
      walletAddress
    });

    try {
      // Get position
      const position = await StakingPosition.findOne({
        where: {
          id: positionId,
          user_id: userId,
          status: 'active'
        }
      });

      if (!position) {
        throw new Error('Position not found or not active');
      }

      // Get current rewards from contract
      const rewards = await this.getRewards(position.staking_contract_address, walletAddress);
      const rewardsDecimal = new Decimal(rewards);

      if (rewardsDecimal.isZero()) {
        throw new Error('No rewards to claim');
      }

      // Execute claim transaction
      const transactionHash = await this.txManager.executeClaimRewards(
        position.staking_contract_address,
        walletAddress
      );

      console.log('Claim rewards transaction submitted', { transactionHash });

      // Update position
      const totalClaimed = new Decimal(position.total_rewards_claimed).add(rewardsDecimal);
      const totalEarned = new Decimal(position.total_rewards_earned).add(rewardsDecimal);

      await position.update({
        unclaimed_rewards: '0',
        total_rewards_claimed: totalClaimed.toString(),
        total_rewards_earned: totalEarned.toString(),
        last_reward_claim_at: new Date(),
        last_updated_at: new Date()
      });

      // Create transaction record
      const transaction = await StakingTransaction.create({
        user_id: userId,
        position_id: position.id,
        transaction_hash: transactionHash,
        type: 'claim_rewards',
        status: 'pending',
        reward_amount: rewardsDecimal.toString(),
        token: position.reward_token
      });

      return {
        success: true,
        transactionHash,
        rewardsClaimed: rewardsDecimal.toString(),
        position: {
          id: position.id,
          totalRewardsClaimed: position.total_rewards_claimed
        },
        transaction: {
          id: transaction.id,
          status: transaction.status
        }
      };
    } catch (error) {
      console.error('Error claiming rewards:', error);
      throw error;
    }
  }

  /**
   * Get rewards for a wallet address from contract
   * 
   * @param {string} stakingContractAddress - Staking contract address
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<string>} Rewards amount
   */
  async getRewards(stakingContractAddress, walletAddress) {
    try {
      // Call contract to get rewards
      // This would use StarknetContractManager to call the get_rewards function
      const rewards = await this.contracts.call(
        stakingContractAddress,
        'get_rewards',
        [walletAddress]
      );

      return rewards.toString();
    } catch (error) {
      console.error('Error getting rewards:', error);
      throw error;
    }
  }

  /**
   * Update position with latest rewards
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Updated position data
   */
  async updatePositionRewards(positionId) {
    console.log('TroveStakingService.updatePositionRewards called', { positionId });

    try {
      const position = await StakingPosition.findByPk(positionId);

      if (!position) {
        throw new Error('Position not found');
      }

      // Get current rewards from contract
      // Note: We would need the wallet address here
      // For now, we'll calculate based on APY if available

      if (position.current_apy && parseFloat(position.staked_amount) > 0) {
        const stakingDuration = position.getStakingDuration();
        const dailyRewards = position.estimateDailyRewards();
        const estimatedRewards = dailyRewards * stakingDuration;

        const totalEarned = new Decimal(position.total_rewards_claimed).add(estimatedRewards);

        await position.update({
          unclaimed_rewards: estimatedRewards.toString(),
          total_rewards_earned: totalEarned.toString(),
          last_updated_at: new Date()
        });
      }

      return {
        positionId: position.id,
        stakedAmount: position.staked_amount,
        unclaimedRewards: position.unclaimed_rewards,
        totalRewardsEarned: position.total_rewards_earned,
        currentAPY: position.current_apy
      };
    } catch (error) {
      console.error('Error updating position rewards:', error);
      throw error;
    }
  }

  /**
   * Get staking position details
   * 
   * @param {string} positionId - Position ID
   * @returns {Promise<Object>} Position details
   */
  async getPosition(positionId) {
    try {
      const position = await StakingPosition.findByPk(positionId);

      if (!position) {
        throw new Error('Position not found');
      }

      // Get token prices
      const stakingTokenPrice = await this.oracle.getPrice(position.staking_token);
      const rewardTokenPrice = await this.oracle.getPrice(position.reward_token);

      const totalValue = position.getTotalValue(stakingTokenPrice, rewardTokenPrice);
      const stakingDuration = position.getStakingDuration();
      const dailyRewards = position.estimateDailyRewards();

      return {
        id: position.id,
        stakingContractAddress: position.staking_contract_address,
        stakingToken: position.staking_token,
        rewardToken: position.reward_token,
        stakedAmount: position.staked_amount,
        unclaimedRewards: position.unclaimed_rewards,
        totalRewardsClaimed: position.total_rewards_claimed,
        totalRewardsEarned: position.total_rewards_earned,
        currentAPY: position.current_apy,
        status: position.status,
        stakingDuration,
        dailyRewards: dailyRewards.toString(),
        totalValue: totalValue.toString(),
        stakedAt: position.staked_at,
        lastUpdatedAt: position.last_updated_at
      };
    } catch (error) {
      console.error('Error getting position:', error);
      throw error;
    }
  }

  /**
   * Get all staking positions for a user
   * 
   * @param {string} userId - User ID
   * @param {string} status - Filter by status (optional)
   * @returns {Promise<Array>} List of positions
   */
  async getUserPositions(userId, status = null) {
    try {
      const positions = await StakingPosition.findUserPositions(userId, status);

      const positionDetails = await Promise.all(
        positions.map(async (position) => {
          try {
            return await this.getPosition(position.id);
          } catch (error) {
            console.error(`Error getting position ${position.id}:`, error);
            return null;
          }
        })
      );

      return positionDetails.filter(p => p !== null);
    } catch (error) {
      console.error('Error getting user positions:', error);
      throw error;
    }
  }

  /**
   * Get staking analytics for a user
   * 
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Staking analytics
   */
  async getUserStakingAnalytics(userId) {
    try {
      const positions = await StakingPosition.findUserPositions(userId, 'active');

      let totalStaked = new Decimal(0);
      let totalRewards = new Decimal(0);
      let totalValue = new Decimal(0);
      let weightedAPY = new Decimal(0);

      for (const position of positions) {
        const stakedAmount = new Decimal(position.staked_amount);
        const rewards = new Decimal(position.total_rewards_earned);

        totalStaked = totalStaked.add(stakedAmount);
        totalRewards = totalRewards.add(rewards);

        // Get token prices
        try {
          const stakingTokenPrice = await this.oracle.getPrice(position.staking_token);
          const rewardTokenPrice = await this.oracle.getPrice(position.reward_token);
          
          const positionValue = position.getTotalValue(stakingTokenPrice, rewardTokenPrice);
          totalValue = totalValue.add(positionValue);

          // Calculate weighted APY
          if (position.current_apy) {
            const apy = new Decimal(position.current_apy);
            const stakedValue = stakedAmount.mul(stakingTokenPrice);
            weightedAPY = weightedAPY.add(apy.mul(stakedValue));
          }
        } catch (error) {
          console.warn(`Failed to get prices for position ${position.id}:`, error.message);
        }
      }

      const averageAPY = totalValue.gt(0) ? weightedAPY.div(totalValue) : new Decimal(0);

      return {
        totalStaked: totalStaked.toString(),
        totalRewards: totalRewards.toString(),
        totalValue: totalValue.toString(),
        averageAPY: averageAPY.toString(),
        activePositions: positions.length
      };
    } catch (error) {
      console.error('Error getting user staking analytics:', error);
      throw error;
    }
  }

  /**
   * Validate amount is positive
   * 
   * @param {string|number|Decimal} amount - Amount to validate
   * @param {string} fieldName - Field name for error message
   * @returns {Decimal} Validated amount
   */
  validateAmount(amount, fieldName = 'amount') {
    try {
      const amountDecimal = new Decimal(amount);
      
      if (amountDecimal.isNaN() || amountDecimal.lte(0)) {
        throw new Error(`${fieldName} must be greater than zero`);
      }

      return amountDecimal;
    } catch (error) {
      throw new Error(`Invalid ${fieldName}: ${error.message}`);
    }
  }

  /**
   * Validate Starknet address format
   * 
   * @param {string} address - Address to validate
   * @param {string} fieldName - Field name for error message
   */
  validateAddress(address, fieldName = 'address') {
    if (!address || typeof address !== 'string') {
      throw new Error(`${fieldName} must be a string`);
    }

    if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) {
      throw new Error(`${fieldName} has invalid format`);
    }
  }
}

// Export singleton instance
const troveStakingService = new TroveStakingService();

module.exports = troveStakingService;
