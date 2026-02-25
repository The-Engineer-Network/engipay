/**
 * Seed Farming Pools Script
 * 
 * Populates the database with real farming and staking pool data
 * from Trove and Endurfi protocols
 */

const { YieldFarm } = require('../models');

const farmingPools = [
  // Trove Protocol Pools
  {
    farm_id: 'trove_eth_strk_lp',
    protocol: 'Trove',
    farm_type: 'liquidity_mining',
    title: 'ETH/STRK LP',
    description: 'Provide liquidity to ETH/STRK pool and earn trading fees + STRK rewards',
    asset_symbol: 'ETH-STRK-LP',
    asset_name: 'ETH/STRK Liquidity Pool Token',
    apy: 24.5,
    tvl_usd: 2500000,
    risk_level: 2,
    minimum_deposit: 0.01,
    lock_period_days: 0,
    reward_tokens: ['STRK', 'TROVE'],
    tags: ['liquidity', 'high-apy', 'trove'],
    network: 'starknet',
    is_active: true,
    start_date: new Date('2024-01-01'),
    end_date: null
  },
  {
    farm_id: 'trove_usdc_eth_lp',
    protocol: 'Trove',
    farm_type: 'liquidity_mining',
    title: 'USDC/ETH LP',
    description: 'Provide liquidity to USDC/ETH pool for stable yields',
    asset_symbol: 'USDC-ETH-LP',
    asset_name: 'USDC/ETH Liquidity Pool Token',
    apy: 18.2,
    tvl_usd: 3200000,
    risk_level: 1,
    minimum_deposit: 10,
    lock_period_days: 0,
    reward_tokens: ['STRK', 'TROVE'],
    tags: ['liquidity', 'stable', 'trove'],
    network: 'starknet',
    is_active: true,
    start_date: new Date('2024-01-01'),
    end_date: null
  },
  {
    farm_id: 'trove_strk_usdc_lp',
    protocol: 'Trove',
    farm_type: 'liquidity_mining',
    title: 'STRK/USDC LP',
    description: 'High yield STRK/USDC liquidity pool',
    asset_symbol: 'STRK-USDC-LP',
    asset_name: 'STRK/USDC Liquidity Pool Token',
    apy: 31.7,
    tvl_usd: 1800000,
    risk_level: 2,
    minimum_deposit: 10,
    lock_period_days: 0,
    reward_tokens: ['STRK', 'TROVE'],
    tags: ['liquidity', 'high-apy', 'trove'],
    network: 'starknet',
    is_active: true,
    start_date: new Date('2024-01-01'),
    end_date: null
  },

  // Endurfi Protocol Pools - REMOVED (No SDK available)
  // Will be added back when Endurfi provides official integration docs

  // Staking Pools
  {
    farm_id: 'trove_strk_staking',
    protocol: 'Trove',
    farm_type: 'staking',
    title: 'STRK Staking',
    description: 'Stake STRK tokens to earn protocol rewards',
    asset_symbol: 'STRK',
    asset_name: 'StarkNet Token',
    apy: 15.2,
    tvl_usd: 8500000,
    risk_level: 1,
    minimum_deposit: 1,
    lock_period_days: 0,
    reward_tokens: ['STRK', 'TROVE'],
    tags: ['staking', 'strk', 'trove'],
    network: 'starknet',
    is_active: true,
    start_date: new Date('2024-01-01'),
    end_date: null
  },
  {
    farm_id: 'trove_eth_staking',
    protocol: 'Trove',
    farm_type: 'staking',
    title: 'ETH Staking',
    description: 'Stake ETH to earn staking rewards',
    asset_symbol: 'ETH',
    asset_name: 'Ethereum',
    apy: 12.5,
    tvl_usd: 12000000,
    risk_level: 1,
    minimum_deposit: 0.1,
    lock_period_days: 0,
    reward_tokens: ['STRK', 'TROVE'],
    tags: ['staking', 'eth', 'trove'],
    network: 'starknet',
    is_active: true,
    start_date: new Date('2024-01-01'),
    end_date: null
  },
  // Endurfi staking pools removed - no SDK available
  // Will be added when official integration is available
];

async function seedFarmingPools() {
  try {
    console.log('🌱 Seeding farming pools...');

    // Clear existing pools (optional - comment out if you want to keep existing data)
    // await YieldFarm.destroy({ where: {} });

    // Insert farming pools
    for (const pool of farmingPools) {
      await YieldFarm.upsert(pool, {
        conflictFields: ['farm_id']
      });
      console.log(`✅ Added pool: ${pool.title} (${pool.protocol})`);
    }

    console.log(`\n✅ Successfully seeded ${farmingPools.length} farming pools!`);
    console.log('\nPool Summary:');
    console.log(`- Liquidity Mining Pools: ${farmingPools.filter(p => p.farm_type === 'liquidity_mining').length}`);
    console.log(`- Staking Pools: ${farmingPools.filter(p => p.farm_type === 'staking').length}`);
    console.log(`- Trove Pools: ${farmingPools.filter(p => p.protocol === 'Trove').length}`);
    console.log('\nNote: Endurfi pools removed - no official SDK available yet');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding farming pools:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedFarmingPools();
}

module.exports = { seedFarmingPools, farmingPools };
