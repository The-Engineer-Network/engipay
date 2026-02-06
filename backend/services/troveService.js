const { Contract, RpcProvider } = require('starknet');
const Decimal = require('decimal.js');
require('dotenv').config();

/**
 * Trove Service - Backend Dev 2
 * Handles staking and yield farming on Troves.fi (formerly STRKFarm)
 * 
 * Troves.fi is a yield aggregator on StarkNet that provides:
 * - Automated yield farming strategies
 * - Staking pools with STRK rewards
 * - Auto-compounding vaults
 * 
 * Documentation: https://docs.troves.fi/
 */

class TroveService {
  constructor() {
    this.provider = null;
    this.initialized = false;
    
    // Troves.fi contract addresses (mainnet)
    this.contracts = {
      accessControl: