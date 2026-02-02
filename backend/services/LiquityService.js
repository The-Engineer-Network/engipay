/**
 * Liquity Protocol Service
 * 
 * Core service for interacting with Liquity protocol
 * Handles Trove operations, Stability Pool, and LQTY staking
 */

const { ethers } = require('ethers');
const { EthersLiquity, Trove } = require('@liquity/lib-ethers');
const { LIQUITY_CONFIG, getContractAddresses } = require('../config/liquity.config');
const LiquityTrove = require('../models/LiquityTrove');
const LiquityTransaction = require('../models/LiquityTransaction');
const LiquityStabilityDeposit = require('../models/LiquityStabilityDeposit');

class LiquityService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.liquity = null;
    this.initialized = false;
  }

  /**
   * Initialize Liquity connection
   */
  async initialize() {
    try {
      // Create provider (ethers v5 syntax)
      this.provider = new ethers.providers.JsonRpcProvider(LIQUITY_CONFIG.rpcUrl);
      
      // Create wallet
      if (!LIQUITY_CONFIG.privateKey) {
        throw new Error('Ethereum private key not configured');
      }
      
      this.wallet = new ethers.Wallet(LIQUITY_CONFIG.privateKey, this.provider);
      
      // Connect to Liquity
      this.liquity = await EthersLiquity.connect(this.wallet);
      
      this.initialized = true;
      console.log(' Liquity service initialized');
      console.log(` Network: ${LIQUITY_CONFIG.network}`);
      console.log(` Wallet: ${this.wallet.address}`);
      
      return true;
    } catch (error) {
      console.error(' Failed to initialize Liquity service:', error);
      throw error;
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

  /**
   * Get current ETH price from Liquity price feed
   */
  async getEthPrice() {
    await this.ensureInitialized();
    
    try {
      const price = await this.liquity.getPrice();
      return parseFloat(price.toString());
    } catch (error) {
      console.error('Error fetching ETH price:', error);
      throw error;
    }
  }

  /**
   * Get Trove state for an address
   */
  async getTrove(address = null) {
    await this.ensureInitialized();
    
    try {
      const targetAddress = address || this.wallet.address;
      const trove = await this.liquity.getTrove(targetAddress);
      const ethPrice = await this.getEthPrice();
      
      return {
        address: targetAddress,
        collateral: parseFloat(trove.collateral.toString()),
        debt: parseFloat(trove.debt.toString()),
        collateralRatio: trove.collateralRatio(ethPrice),
        status: trove.status,
        ethPrice,
        liquidationPrice: this.calculateLiquidationPrice(
          parseFloat(trove.collateral.toString()),
          parseFloat(trove.debt.toString())
        ),
      };
    } catch (error) {
      console.error('Error fetching Trove:', error);
      throw error;
    }
  }

  /**
   * Open a new Trove
   */
  async openTrove(userId, depositCollateral, borrowLUSD, maxBorrowingRate = 0.05) {
    await this.ensureInitialized();
    
    try {
      // Validate parameters
      if (borrowLUSD < LIQUITY_CONFIG.parameters.minDebt) {
        throw new Error(`Minimum debt is ${LIQUITY_CONFIG.parameters.minDebt} LUSD`);
      }
      
      // Calculate expected collateral ratio
      const ethPrice = await this.getEthPrice();
      const expectedCR = (depositCollateral * ethPrice) / borrowLUSD;
      
      if (expectedCR < LIQUITY_CONFIG.parameters.minCollateralRatio) {
        throw new Error(
          `Collateral ratio ${expectedCR.toFixed(2)} is below minimum ${LIQUITY_CONFIG.parameters.minCollateralRatio}`
        );
      }
      
      console.log(`Opening Trove: ${depositCollateral} ETH, ${borrowLUSD} LUSD`);
      console.log(`Expected CR: ${(expectedCR * 100).toFixed(2)}%`);
      
      // Get current Trove state (should be empty)
      const currentTrove = await this.liquity.getTrove();
      
      // Open Trove (ethers v5 syntax)
      const params = {
        depositCollateral: ethers.utils.parseEther(depositCollateral.toString()),
        borrowLUSD: ethers.utils.parseEther(borrowLUSD.toString()),
      };
      
      const tx = await this.liquity.openTrove(params, {
        maxBorrowingRate: ethers.utils.parseUnits(maxBorrowingRate.toString(), 18),
      });
      
      // Create transaction record
      const txRecord = await LiquityTransaction.create({
        userId,
        txHash: tx.hash,
        type: 'open_trove',
        status: 'pending',
        ethAmount: depositCollateral,
        lusdAmount: borrowLUSD,
        beforeState: {
          collateral: 0,
          debt: 0,
        },
      });
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      // Get new Trove state
      const newTrove = await this.getTrove();
      
      // Update transaction (ethers v5 syntax)
      await txRecord.update({
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.gasPrice?.toString(),
        gasCost: ethers.utils.formatEther(receipt.gasUsed.mul(receipt.gasPrice || 0)),
        afterState: {
          collateral: newTrove.collateral,
          debt: newTrove.debt,
          collateralRatio: newTrove.collateralRatio,
        },
      });
      
      // Create Trove record
      const trove = await LiquityTrove.create({
        userId,
        ownerAddress: this.wallet.address,
        status: 'active',
        collateral: newTrove.collateral,
        debt: newTrove.debt,
        collateralRatio: newTrove.collateralRatio,
        ethPrice: newTrove.ethPrice,
        liquidationPrice: newTrove.liquidationPrice,
        openTxHash: tx.hash,
        openedAt: new Date(),
        borrowingFeePaid: borrowLUSD * 0.005, // Approximate
        liquidationReserve: 200,
      });
      
      trove.healthScore = trove.calculateHealthScore();
      trove.updateRiskLevel();
      await trove.save();
      
      console.log(' Trove opened successfully');
      
      return {
        success: true,
        trove: trove.toJSON(),
        transaction: txRecord.toJSON(),
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('Error opening Trove:', error);
      throw error;
    }
  }

  /**
   * Close Trove
   */
  async closeTrove(userId, troveId) {
    await this.ensureInitialized();
    
    try {
      // Get Trove record
      const trove = await LiquityTrove.findOne({
        where: { id: troveId, userId, status: 'active' },
      });
      
      if (!trove) {
        throw new Error('Trove not found or already closed');
      }
      
      // Get current state
      const currentState = await this.getTrove();
      
      console.log(`Closing Trove: ${troveId}`);
      console.log(`Debt to repay: ${currentState.debt} LUSD`);
      
      // Close Trove
      const tx = await this.liquity.closeTrove();
      
      // Create transaction record
      const txRecord = await LiquityTransaction.create({
        userId,
        troveId,
        txHash: tx.hash,
        type: 'close_trove',
        status: 'pending',
        lusdAmount: currentState.debt,
        beforeState: {
          collateral: currentState.collateral,
          debt: currentState.debt,
        },
      });
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      // Update transaction (ethers v5 syntax)
      await txRecord.update({
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.gasPrice?.toString(),
        gasCost: ethers.utils.formatEther(receipt.gasUsed.mul(receipt.gasPrice || 0)),
        afterState: {
          collateral: 0,
          debt: 0,
        },
      });
      
      // Update Trove record
      await trove.update({
        status: 'closed',
        closeTxHash: tx.hash,
        closedAt: new Date(),
        collateral: 0,
        debt: 0,
        collateralRatio: 0,
      });
      
      console.log(' Trove closed successfully');
      
      return {
        success: true,
        trove: trove.toJSON(),
        transaction: txRecord.toJSON(),
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('Error closing Trove:', error);
      throw error;
    }
  }

  /**
   * Adjust Trove - add/remove collateral or borrow/repay debt
   */
  async adjustTrove(userId, troveId, params) {
    await this.ensureInitialized();
    
    try {
      const {
        depositCollateral,
        withdrawCollateral,
        borrowLUSD,
        repayLUSD,
      } = params;
      
      // Get Trove record
      const trove = await LiquityTrove.findOne({
        where: { id: troveId, userId, status: 'active' },
      });
      
      if (!trove) {
        throw new Error('Trove not found or not active');
      }
      
      // Get current state
      const currentState = await this.getTrove();
      
      // Build adjustment params
      const adjustParams = {};
      let txType = 'adjust_trove';
      
      if (depositCollateral && depositCollateral > 0) {
        adjustParams.depositCollateral = ethers.utils.parseEther(depositCollateral.toString());
        txType = 'adjust_trove_add_collateral';
      }
      
      if (withdrawCollateral && withdrawCollateral > 0) {
        adjustParams.withdrawCollateral = ethers.utils.parseEther(withdrawCollateral.toString());
        txType = 'adjust_trove_withdraw_collateral';
      }
      
      if (borrowLUSD && borrowLUSD > 0) {
        adjustParams.borrowLUSD = ethers.utils.parseEther(borrowLUSD.toString());
        txType = 'adjust_trove_borrow';
      }
      
      if (repayLUSD && repayLUSD > 0) {
        adjustParams.repayLUSD = ethers.utils.parseEther(repayLUSD.toString());
        txType = 'adjust_trove_repay';
      }
      
      console.log(`Adjusting Trove: ${troveId}`, adjustParams);
      
      // Execute adjustment
      const tx = await this.liquity.adjustTrove(adjustParams);
      
      // Create transaction record
      const txRecord = await LiquityTransaction.create({
        userId,
        troveId,
        txHash: tx.hash,
        type: txType,
        status: 'pending',
        ethAmount: depositCollateral || withdrawCollateral || null,
        lusdAmount: borrowLUSD || repayLUSD || null,
        beforeState: {
          collateral: currentState.collateral,
          debt: currentState.debt,
          collateralRatio: currentState.collateralRatio,
        },
      });
      
      // Wait for confirmation
      const receipt = await tx.wait();
      
      // Get new state
      const newState = await this.getTrove();
      
      // Update transaction (ethers v5 syntax)
      await txRecord.update({
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.gasPrice?.toString(),
        gasCost: ethers.utils.formatEther(receipt.gasUsed.mul(receipt.gasPrice || 0)),
        afterState: {
          collateral: newState.collateral,
          debt: newState.debt,
          collateralRatio: newState.collateralRatio,
        },
      });
      
      // Update Trove record
      await trove.update({
        collateral: newState.collateral,
        debt: newState.debt,
        collateralRatio: newState.collateralRatio,
        ethPrice: newState.ethPrice,
        liquidationPrice: newState.liquidationPrice,
      });
      
      trove.healthScore = trove.calculateHealthScore();
      trove.updateRiskLevel();
      await trove.save();
      
      console.log(' Trove adjusted successfully');
      
      return {
        success: true,
        trove: trove.toJSON(),
        transaction: txRecord.toJSON(),
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('Error adjusting Trove:', error);
      throw error;
    }
  }

  /**
   * Calculate liquidation price
   */
  calculateLiquidationPrice(collateral, debt) {
    if (collateral === 0) return 0;
    return (debt * 1.1) / collateral;
  }

  /**
   * Deposit LUSD to Stability Pool
   */
  async depositToStabilityPool(userId, amount) {
    await this.ensureInitialized();
    
    try {
      console.log(`Depositing ${amount} LUSD to Stability Pool`);
      
      const tx = await this.liquity.depositLUSDInStabilityPool(
        ethers.utils.parseEther(amount.toString())
      );
      
      // Create transaction record
      const txRecord = await LiquityTransaction.create({
        userId,
        txHash: tx.hash,
        type: 'stability_deposit',
        status: 'pending',
        lusdAmount: amount,
      });
      
      const receipt = await tx.wait();
      
      await txRecord.update({
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.gasPrice?.toString(),
        gasCost: ethers.utils.formatEther(receipt.gasUsed.mul(receipt.gasPrice || 0)),
      });
      
      // Create or update stability deposit record
      const [deposit] = await LiquityStabilityDeposit.findOrCreate({
        where: {
          userId,
          depositorAddress: this.wallet.address,
          status: 'active',
        },
        defaults: {
          depositAmount: amount,
          initialDeposit: amount,
          depositedAt: new Date(),
        },
      });
      
      if (!deposit.isNewRecord) {
        await deposit.update({
          depositAmount: parseFloat(deposit.depositAmount) + amount,
        });
      }
      
      console.log(' Deposited to Stability Pool successfully');
      
      return {
        success: true,
        deposit: deposit.toJSON(),
        transaction: txRecord.toJSON(),
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('Error depositing to Stability Pool:', error);
      throw error;
    }
  }

  /**
   * Withdraw from Stability Pool
   */
  async withdrawFromStabilityPool(userId, amount) {
    await this.ensureInitialized();
    
    try {
      console.log(`Withdrawing ${amount} LUSD from Stability Pool`);
      
      const tx = await this.liquity.withdrawLUSDFromStabilityPool(
        ethers.utils.parseEther(amount.toString())
      );
      
      const txRecord = await LiquityTransaction.create({
        userId,
        txHash: tx.hash,
        type: 'stability_withdraw',
        status: 'pending',
        lusdAmount: amount,
      });
      
      const receipt = await tx.wait();
      
      await txRecord.update({
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        gasPrice: receipt.gasPrice?.toString(),
        gasCost: ethers.utils.formatEther(receipt.gasUsed.mul(receipt.gasPrice || 0)),
      });
      
      // Update stability deposit record
      const deposit = await LiquityStabilityDeposit.findOne({
        where: {
          userId,
          depositorAddress: this.wallet.address,
          status: 'active',
        },
      });
      
      if (deposit) {
        const newAmount = parseFloat(deposit.depositAmount) - amount;
        await deposit.update({
          depositAmount: Math.max(0, newAmount),
          status: newAmount <= 0 ? 'withdrawn' : 'partial',
          withdrawnAt: newAmount <= 0 ? new Date() : null,
        });
      }
      
      console.log(' Withdrawn from Stability Pool successfully');
      
      return {
        success: true,
        deposit: deposit?.toJSON(),
        transaction: txRecord.toJSON(),
        txHash: tx.hash,
      };
    } catch (error) {
      console.error('Error withdrawing from Stability Pool:', error);
      throw error;
    }
  }

  /**
   * Get Stability Pool deposit info
   */
  async getStabilityDeposit(address = null) {
    await this.ensureInitialized();
    
    try {
      const targetAddress = address || this.wallet.address;
      const deposit = await this.liquity.getStabilityDeposit(targetAddress);
      
      return {
        address: targetAddress,
        currentLUSD: parseFloat(deposit.currentLUSD.toString()),
        initialLUSD: parseFloat(deposit.initialLUSD.toString()),
        collateralGain: parseFloat(deposit.collateralGain.toString()),
        lqtyReward: parseFloat(deposit.lqtyReward.toString()),
      };
    } catch (error) {
      console.error('Error fetching Stability Pool deposit:', error);
      throw error;
    }
  }

  /**
   * Get total collateral ratio (TCR) of the system
   */
  async getTotalCollateralRatio() {
    await this.ensureInitialized();
    
    try {
      const total = await this.liquity.getTotal();
      const ethPrice = await this.getEthPrice();
      
      return {
        totalCollateral: parseFloat(total.collateral.toString()),
        totalDebt: parseFloat(total.debt.toString()),
        tcr: total.collateralRatio(ethPrice),
        recoveryMode: total.collateralRatio(ethPrice) < 1.5,
      };
    } catch (error) {
      console.error('Error fetching TCR:', error);
      throw error;
    }
  }
}

// Export singleton instance
const liquityService = new LiquityService();

module.exports = liquityService;
