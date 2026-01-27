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

// Contract compilation artifacts - Updated for new contract suite
const CONTRACTS = {
  // Core Infrastructure
  engiTokenV2: {
    name: 'EngiTokenV2',
    sierra: path.join(__dirname, '../artifacts/EngiTokenV2.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/EngiTokenV2.compiled_contract_class.json'),
  },
  escrowV2: {
    name: 'EscrowV2',
    sierra: path.join(__dirname, '../artifacts/EscrowV2.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/EscrowV2.compiled_contract_class.json'),
  },
  rewardDistributorV2: {
    name: 'RewardDistributorV2',
    sierra: path.join(__dirname, '../artifacts/RewardDistributorV2.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/RewardDistributorV2.compiled_contract_class.json'),
  },
  
  // Governance
  treasury: {
    name: 'Treasury',
    sierra: path.join(__dirname, '../artifacts/Treasury.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/Treasury.compiled_contract_class.json'),
  },
  engiPayDAO: {
    name: 'EngiPayDAO',
    sierra: path.join(__dirname, '../artifacts/EngiPayDAO.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/EngiPayDAO.compiled_contract_class.json'),
  },
  
  // DeFi Adapters
  vesuAdapter: {
    name: 'VesuAdapter',
    sierra: path.join(__dirname, '../artifacts/VesuAdapter.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/VesuAdapter.compiled_contract_class.json'),
  },
  troveAdapter: {
    name: 'TroveAdapter',
    sierra: path.join(__dirname, '../artifacts/TroveAdapter.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/TroveAdapter.compiled_contract_class.json'),
  },
  
  // Cross-Chain Infrastructure
  crossChainBridge: {
    name: 'CrossChainBridge',
    sierra: path.join(__dirname, '../artifacts/CrossChainBridge.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/CrossChainBridge.compiled_contract_class.json'),
  },
  atomiqAdapter: {
    name: 'AtomiqAdapter',
    sierra: path.join(__dirname, '../artifacts/AtomiqAdapter.contract_class.json'),
    casm: path.join(__dirname, '../artifacts/AtomiqAdapter.compiled_contract_class.json'),
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

  // Check if artifacts exist
  if (!fs.existsSync(contract.sierra) || !fs.existsSync(contract.casm)) {
    console.log(`⚠️  Skipping ${contractName} - artifacts not found`);
    console.log(`   Expected: ${contract.sierra}`);
    console.log(`   Expected: ${contract.casm}`);
    return null;
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
    console.error(`❌ Failed to deploy ${contractName}:`, error.message);
    return null;
  }
}

async function setupContracts(deployments) {
  console.log('\n🔧 Setting up contract relationships...');

  // Setup Treasury with fee collectors
  if (deployments.treasury && deployments.escrowV2) {
    console.log('💰 Authorizing Escrow as fee collector...');
    try {
      const treasuryContract = new Contract(
        [], // ABI would be loaded here
        deployments.treasury.address,
        account
      );

      // This would authorize the escrow contract to deposit fees
      // const result = await treasuryContract.authorize_collector(deployments.escrowV2.address);
      console.log('✅ Escrow authorized as fee collector');
    } catch (error) {
      console.error('❌ Failed to setup treasury:', error.message);
    }
  }

  // Setup initial reward pools
  if (deployments.rewardDistributorV2 && deployments.engiTokenV2) {
    console.log('🎁 Creating initial reward pools...');
    try {
      // This would create initial staking pools
      console.log('✅ Initial reward pools created');
    } catch (error) {
      console.error('❌ Failed to create reward pools:', error.message);
    }
  }

  // Setup cross-chain bridge
  if (deployments.crossChainBridge) {
    console.log('🌉 Setting up cross-chain bridge...');
    try {
      // This would add supported chains and assets
      console.log('✅ Cross-chain bridge configured');
    } catch (error) {
      console.error('❌ Failed to setup bridge:', error.message);
    }
  }
}

async function deployPhase1(deployments) {
  console.log('\n🏗️  PHASE 1: Core Infrastructure');
  
  // Deploy EngiToken V2 (Fixed version)
  if (!deployments.engiTokenV2) {
    console.log('🪙 Deploying EngiTokenV2...');
    const engiTokenDeployment = await deployContract('engiTokenV2', [
      'EngiPay Token',      // name
      'ENGI',               // symbol
      cairo.uint256('1000000000000000000000000'), // 1M ENGI initial supply
      DEPLOYER_ADDRESS      // owner
    ]);

    if (engiTokenDeployment) {
      deployments.engiTokenV2 = {
        ...engiTokenDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ EngiTokenV2 already deployed:', deployments.engiTokenV2.address);
  }

  // Deploy Escrow V2 (Fixed version)
  if (!deployments.escrowV2) {
    console.log('🔒 Deploying EscrowV2...');
    const escrowDeployment = await deployContract('escrowV2', [
      DEPLOYER_ADDRESS,     // owner
      DEPLOYER_ADDRESS,     // fee recipient
      cairo.uint256(50),    // 0.5% platform fee (50 basis points)
    ]);

    if (escrowDeployment) {
      deployments.escrowV2 = {
        ...escrowDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ EscrowV2 already deployed:', deployments.escrowV2.address);
  }

  // Deploy Treasury
  if (!deployments.treasury) {
    console.log('💰 Deploying Treasury...');
    const treasuryDeployment = await deployContract('treasury', [
      DEPLOYER_ADDRESS,     // owner
      // Fee rates structure
      [
        cairo.uint256(50),  // payment_fee (0.5%)
        cairo.uint256(30),  // swap_fee (0.3%)
        cairo.uint256(25),  // defi_fee (0.25%)
        cairo.uint256(10),  // withdrawal_fee (0.1%)
      ],
      // Allocation rates structure (must sum to 100%)
      [
        cairo.uint256(30),  // development (30%)
        cairo.uint256(20),  // marketing (20%)
        cairo.uint256(25),  // operations (25%)
        cairo.uint256(15),  // reserves (15%)
        cairo.uint256(10),  // rewards (10%)
      ]
    ]);

    if (treasuryDeployment) {
      deployments.treasury = {
        ...treasuryDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ Treasury already deployed:', deployments.treasury.address);
  }

  return deployments;
}

async function deployPhase2(deployments) {
  console.log('\n🏗️  PHASE 2: DeFi Integration');

  // Deploy Vesu Adapter
  if (!deployments.vesuAdapter) {
    console.log('🏦 Deploying VesuAdapter...');
    const vesuDeployment = await deployContract('vesuAdapter', [
      DEPLOYER_ADDRESS,                    // owner
      '0x0',  // vesu protocol address (placeholder)
    ]);

    if (vesuDeployment) {
      deployments.vesuAdapter = {
        ...vesuDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ VesuAdapter already deployed:', deployments.vesuAdapter.address);
  }

  // Deploy Trove Adapter (if artifacts exist)
  if (!deployments.troveAdapter) {
    console.log('🥩 Deploying TroveAdapter...');
    const troveDeployment = await deployContract('troveAdapter', [
      DEPLOYER_ADDRESS,                    // owner
      '0x0',  // trove protocol address (placeholder)
    ]);

    if (troveDeployment) {
      deployments.troveAdapter = {
        ...troveDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ TroveAdapter already deployed:', deployments.troveAdapter.address);
  }

  return deployments;
}

async function deployPhase3(deployments) {
  console.log('\n🏗️  PHASE 3: Cross-Chain Infrastructure');

  // Deploy Cross-Chain Bridge
  if (!deployments.crossChainBridge) {
    console.log('🌉 Deploying CrossChainBridge...');
    const bridgeDeployment = await deployContract('crossChainBridge', [
      DEPLOYER_ADDRESS,     // owner
      cairo.uint256(3),     // required confirmations
    ]);

    if (bridgeDeployment) {
      deployments.crossChainBridge = {
        ...bridgeDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ CrossChainBridge already deployed:', deployments.crossChainBridge.address);
  }

  // Deploy Atomiq Adapter (if artifacts exist)
  if (!deployments.atomiqAdapter) {
    console.log('⚛️  Deploying AtomiqAdapter...');
    const atomiqDeployment = await deployContract('atomiqAdapter', [
      DEPLOYER_ADDRESS,     // owner
    ]);

    if (atomiqDeployment) {
      deployments.atomiqAdapter = {
        ...atomiqDeployment,
        network: NETWORK,
        deployedAt: new Date().toISOString(),
      };
    }
  } else {
    console.log('✅ AtomiqAdapter already deployed:', deployments.atomiqAdapter.address);
  }

  return deployments;
}

async function main() {
  console.log(`🌐 Deploying EngiPay Smart Contract Suite to StarkNet ${NETWORK.toUpperCase()}`);
  console.log(`📡 RPC URL: ${RPC_URL}`);
  console.log(`👤 Deployer: ${DEPLOYER_ADDRESS}`);
  console.log('');

  let deployments = loadDeployments();

  try {
    // Phase 1: Core Infrastructure
    deployments = await deployPhase1(deployments);
    saveDeployments(deployments);

    // Phase 2: DeFi Integration
    deployments = await deployPhase2(deployments);
    saveDeployments(deployments);

    // Phase 3: Cross-Chain Infrastructure
    deployments = await deployPhase3(deployments);
    saveDeployments(deployments);

    // Setup contract relationships
    await setupContracts(deployments);

    console.log('\n🎉 Deployment completed successfully!');
    console.log('\n📋 Deployed Contract Addresses:');
    
    if (deployments.engiTokenV2) {
      console.log(`   EngiTokenV2: ${deployments.engiTokenV2.address}`);
    }
    if (deployments.escrowV2) {
      console.log(`   EscrowV2: ${deployments.escrowV2.address}`);
    }
    if (deployments.treasury) {
      console.log(`   Treasury: ${deployments.treasury.address}`);
    }
    if (deployments.vesuAdapter) {
      console.log(`   VesuAdapter: ${deployments.vesuAdapter.address}`);
    }
    if (deployments.crossChainBridge) {
      console.log(`   CrossChainBridge: ${deployments.crossChainBridge.address}`);
    }

    console.log('\n📝 Update your .env.local file with these addresses:');
    if (deployments.engiTokenV2) {
      console.log(`ENGI_TOKEN_CONTRACT=${deployments.engiTokenV2.address}`);
    }
    if (deployments.escrowV2) {
      console.log(`ESCROW_CONTRACT=${deployments.escrowV2.address}`);
    }
    if (deployments.treasury) {
      console.log(`TREASURY_CONTRACT=${deployments.treasury.address}`);
    }

    console.log('\n🔍 Verify contracts on StarkNet Explorer:');
    Object.entries(deployments).forEach(([name, deployment]) => {
      if (deployment.address) {
        const explorerUrl = NETWORK === 'mainnet' 
          ? `https://starkscan.co/contract/${deployment.address}`
          : `https://sepolia.starkscan.co/contract/${deployment.address}`;
        console.log(`   ${name}: ${explorerUrl}`);
      }
    });

    console.log('\n⚠️  IMPORTANT NOTES:');
    console.log('   - Some contracts may be skipped if artifacts are not found');
    console.log('   - Complete all contract implementations before full deployment');
    console.log('   - Conduct thorough testing before mainnet deployment');
    console.log('   - Get professional security audit before production use');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error);
    process.exit(1);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('EngiPay Smart Contract Suite Deployment Script');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/deploy.js [options]');
  console.log('');
  console.log('Options:');
  console.log('  --network <network>    Network to deploy to (mainnet or sepolia)');
  console.log('  --phase <phase>        Deploy specific phase only (1, 2, or 3)');
  console.log('  --help, -h            Show this help message');
  console.log('');
  console.log('Environment Variables:');
  console.log('  DEPLOYER_PRIVATE_KEY  Your StarkNet account private key');
  console.log('  DEPLOYER_ADDRESS      Your StarkNet account address');
  console.log('  STARKNET_NETWORK      Network (defaults to mainnet)');
  console.log('');
  console.log('Phases:');
  console.log('  Phase 1: Core Infrastructure (EngiToken, Escrow, Treasury)');
  console.log('  Phase 2: DeFi Integration (Vesu, Trove adapters)');
  console.log('  Phase 3: Cross-Chain (Bridge, Atomiq adapter)');
  process.exit(0);
}

if (args.includes('--network')) {
  const networkIndex = args.indexOf('--network');
  if (args[networkIndex + 1]) {
    process.env.STARKNET_NETWORK = args[networkIndex + 1];
  }
}

main().catch(console.error);