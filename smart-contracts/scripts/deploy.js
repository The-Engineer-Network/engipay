const { Account, Provider, Contract, CallData, cairo, ec } = require('starknet');
const fs = require('fs');
const path = require('path');

// Configuration
const NETWORK = process.env.STARKNET_NETWORK || 'mainnet'; // 'mainnet' or 'sepolia'
const RPC_URL = NETWORK === 'mainnet'
  ? 'https://starknet-mainnet.public.blastapi.io'
  : 'https://starknet-sepolia.public.blastapi.io';

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const DEPLOYER_ADDRESS = process.env.DEPLOYER_ADDRESS;

if (!DEPLOYER_PRIVATE_KEY || !DEPLOYER_ADDRESS) {
  console.error('❌ Missing environment variables:');
  console.error('   DEPLOYER_PRIVATE_KEY - Your StarkNet account private key');
  console.error('   DEPLOYER_ADDRESS - Your StarkNet account address');
  console.error('');
  console.error('Set them in your .env file or export them:');
  console.error('   export DEPLOYER_PRIVATE_KEY=0x...');
  console.error('   export DEPLOYER_ADDRESS=0x...');
  process.exit(1);
}

// Initialize provider and account
const provider = new Provider({ rpc: { nodeUrl: RPC_URL } });
const account = new Account(provider, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY);

// Contract compilation artifacts
const CONTRACTS = {
  engiToken: {
    name: 'EngiToken',
    sierra: path.join(__dirname, '../artifacts/EngiToken.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/EngiToken.compiled_contract_class.json'),
  },
  escrow: {
    name: 'Escrow',
    sierra: path.join(__dirname, '../artifacts/Escrow.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/Escrow.compiled_contract_class.json'),
  },
  rewardDistributor: {
    name: 'RewardDistributor',
    sierra: path.join(__dirname, '../artifacts/RewardDistributor.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/RewardDistributor.compiled_contract_class.json'),
  },
};

// Deployment addresses storage
const DEPLOYMENT_LOG = path.join(__dirname, '../deployments.json');

function loadDeployments() {
  if (fs.existsSync(DEPLOYMENT_LOG)) {
    return JSON.parse(fs.readFileSync(DEPLOYMENT_LOG, 'utf8'));
  }
  return {};
}

function saveDeployments(deployments) {
  fs.writeFileSync(DEPLOYMENT_LOG, JSON.stringify(deployments, null, 2));
}

async function deployContract(contractName, constructorArgs = []) {
  console.log(`\n🚀 Deploying ${contractName}...`);

  const contract = CONTRACTS[contractName];
  if (!contract) {
    throw new Error(`Contract ${contractName} not found in contracts list`);
  }

  try {
    // Load contract artifacts
    const sierra = JSON.parse(fs.readFileSync(contract.sierra, 'utf8'));
    const casm = JSON.parse(fs.readFileSync(contract.casm, 'utf8'));

    console.log(`📄 Contract class hash: ${sierra.class_hash}`);

    // Declare contract
    console.log('📝 Declaring contract...');
    const declareResult = await account.declare({
      contract: sierra,
      casm: casm,
    });

    console.log(`✅ Declaration successful: ${declareResult.transaction_hash}`);
    await provider.waitForTransaction(declareResult.transaction_hash);

    // Deploy contract
    console.log('🏗️  Deploying contract...');
    const deployResult = await account.deploy({
      classHash: declareResult.class_hash,
      constructorCalldata: constructorArgs,
    });

    console.log(`✅ Deployment successful: ${deployResult.contract_address}`);
    await provider.waitForTransaction(deployResult.transaction_hash);

    return {
      address: deployResult.contract_address,
      transactionHash: deployResult.transaction_hash,
      classHash: declareResult.class_hash,
    };

  } catch (error) {
    console.error(`❌ Failed to deploy ${contractName}:`, error);
    throw error;
  }
}

async function setupContracts() {
  console.log('🔧 Setting up contract relationships...');

  const deployments = loadDeployments();

  // Create initial reward pool in RewardDistributor
  if (deployments.rewardDistributor && deployments.engiToken) {
    console.log('🎁 Creating initial reward pool...');

    const rewardContract = new Contract(
      JSON.parse(fs.readFileSync(path.join(__dirname, '../contracts/RewardDistributorABI.json'), 'utf8')).abi,
      deployments.rewardDistributor.address,
      account
    );

    try {
      const result = await account.execute([
        rewardContract.populate('create_pool', [
          deployments.engiToken.address, // ENGI token as reward token
          cairo.uint256('1000000000000000000'), // 1 ENGI per second reward rate
        ])
      ]);

      console.log(`✅ Reward pool created: ${result.transaction_hash}`);
      await provider.waitForTransaction(result.transaction_hash);

    } catch (error) {
      console.error('❌ Failed to create reward pool:', error);
    }
  }
}

async function main() {
  console.log(`🌐 Deploying to StarkNet ${NETWORK.toUpperCase()}`);
  console.log(`📡 RPC URL: ${RPC_URL}`);
  console.log(`👤 Deployer: ${DEPLOYER_ADDRESS}`);
  console.log('');

  const deployments = loadDeployments();

  try {
    // Deploy EngiToken first (no constructor args needed for basic deployment)
    if (!deployments.engiToken) {
      console.log('🪙 Deploying EngiToken...');
      const engiTokenDeployment = await deployContract('engiToken', [
        'EngiToken',           // name
        'ENGI',               // symbol
        cairo.uint256('1000000000000000000000000'), // 1M ENGI initial supply
        DEPLOYER_ADDRESS      // owner
      ]);

      deployments.engiToken = {
        ...engiTokenDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    } else {
      console.log('✅ EngiToken already deployed:', deployments.engiToken.address);
    }

    // Deploy Escrow
    if (!deployments.escrow) {
      console.log('🔒 Deploying Escrow...');
      const escrowDeployment = await deployContract('escrow', [
        DEPLOYER_ADDRESS,     // owner
        DEPLOYER_ADDRESS,     // fee recipient
        cairo.uint256(50),    // 0.5% platform fee (50 basis points)
      ]);

      deployments.escrow = {
        ...escrowDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    } else {
      console.log('✅ Escrow already deployed:', deployments.escrow.address);
    }

    // Deploy RewardDistributor
    if (!deployments.rewardDistributor) {
      console.log('🎯 Deploying RewardDistributor...');
      const rewardDeployment = await deployContract('rewardDistributor', [
        DEPLOYER_ADDRESS,     // owner
      ]);

      deployments.rewardDistributor = {
        ...rewardDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    } else {
      console.log('✅ RewardDistributor already deployed:', deployments.rewardDistributor.address);
    }

    // Save deployments
    saveDeployments(deployments);

    // Setup contract relationships
    await setupContracts();

    console.log('\n🎉 Deployment completed successfully!');
    console.log('\n📋 Contract Addresses:');
    console.log(`   EngiToken: ${deployments.engiToken.address}`);
    console.log(`   Escrow: ${deployments.escrow.address}`);
    console.log(`   RewardDistributor: ${deployments.rewardDistributor.address}`);

    console.log('\n📝 Update your .env.local file with these addresses:');
    console.log(`ENGI_TOKEN_CONTRACT=${deployments.engiToken.address}`);
    console.log(`ESCROW_CONTRACT=${deployments.escrow.address}`);
    console.log(`REWARD_DISTRIBUTOR_CONTRACT=${deployments.rewardDistributor.address}`);

    console.log('\n🔍 Verify contracts on StarkNet Explorer:');
    console.log(`   https://starkscan.co/contract/${deployments.engiToken.address}`);
    console.log(`   https://starkscan.co/contract/${deployments.escrow.address}`);
    console.log(`   https://starkscan.co/contract/${deployments.rewardDistributor.address}`);

  } catch (error) {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('StarkNet Contract Deployment Script');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/deploy.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --network <network>    Network to deploy to (mainnet or sepolia)');
  console.log('  --help, -h            Show this help message');
  console.log('');
  console.log('Environment Variables:');
  console.log('  DEPLOYER_PRIVATE_KEY  Your StarkNet account private key');
  console.log('  DEPLOYER_ADDRESS      Your StarkNet account address');
  console.log('  STARKNET_NETWORK      Network (defaults to mainnet)');
  process.exit(0);
}

if (args.includes('--network')) {
  const networkIndex = args.indexOf('--network');
  if (args[networkIndex + 1]) {
    process.env.STARKNET_NETWORK = args[networkIndex + 1];
  }
}

main().catch(console.error);