const { Account, Contract, RpcProvider, stark, uint256, CallData } = require('starknet');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Deploy AtomiqAdapter Contract to StarkNet
 * This script deploys the AtomiqAdapter contract for cross-chain BTC <-> STRK swaps
 */

async function deployAtomiqAdapter() {
  try {
    console.log('🚀 Starting AtomiqAdapter deployment...');

    // Initialize provider
    const provider = new RpcProvider({
      nodeUrl: process.env.STARKNET_RPC_URL || 'https://starknet-mainnet.public.blastapi.io'
    });

    // Initialize account
    const privateKey = process.env.STARKNET_PRIVATE_KEY;
    const accountAddress = process.env.STARKNET_ACCOUNT_ADDRESS;
    
    if (!privateKey || !accountAddress) {
      throw new Error('Please set STARKNET_PRIVATE_KEY and STARKNET_ACCOUNT_ADDRESS in .env file');
    }

    const account = new Account(provider, accountAddress, privateKey);
    console.log('✅ Account initialized:', accountAddress);

    // Load contract artifacts
    const contractPath = path.join(__dirname, '../contracts/adapters/AtomiqAdapter.cairo');
    const abiPath = path.join(__dirname, '../contracts/adapters/AtomiqAdapterABI.json');
    
    if (!fs.existsSync(contractPath)) {
      throw new Error(`Contract file not found: ${contractPath}`);
    }
    
    if (!fs.existsSync(abiPath)) {
      throw new Error(`ABI file not found: ${abiPath}`);
    }

    const contractSource = fs.readFileSync(contractPath, 'utf8');
    const contractAbi = JSON.parse(fs.readFileSync(abiPath, 'utf8'));

    console.log('✅ Contract artifacts loaded');

    // Compile contract (in production, use starknet-compile)
    // For now, we'll assume the contract is already compiled
    console.log('⚠️  Note: Contract compilation should be done with starknet-compile');
    console.log('   Run: starknet-compile contracts/adapters/AtomiqAdapter.cairo --output compiled/AtomiqAdapter.json');

    // Deployment parameters
    const deploymentParams = {
      owner: accountAddress,
      fee_recipient: process.env.FEE_RECIPIENT_ADDRESS || accountAddress,
      platform_fee: 50, // 0.5% in basis points
      swap_timeout: 86400 // 24 hours in seconds
    };

    console.log('📋 Deployment parameters:');
    console.log('   Owner:', deploymentParams.owner);
    console.log('   Fee Recipient:', deploymentParams.fee_recipient);
    console.log('   Platform Fee:', deploymentParams.platform_fee, 'basis points (0.5%)');
    console.log('   Swap Timeout:', deploymentParams.swap_timeout, 'seconds (24 hours)');

    // Prepare constructor calldata
    const constructorCalldata = CallData.compile({
      owner: deploymentParams.owner,
      fee_recipient: deploymentParams.fee_recipient,
      platform_fee: uint256.bnToUint256(deploymentParams.platform_fee),
      swap_timeout: deploymentParams.swap_timeout
    });

    console.log('📦 Constructor calldata prepared');

    // Deploy contract
    console.log('🔄 Deploying contract...');
    
    // Note: This is a placeholder for the actual deployment
    // In production, you would use the compiled contract class hash
    const classHash = process.env.ATOMIQ_ADAPTER_CLASS_HASH;
    
    if (!classHash) {
      console.log('⚠️  CLASS_HASH not provided. To deploy:');
      console.log('1. Compile the contract: starknet-compile contracts/adapters/AtomiqAdapter.cairo');
      console.log('2. Declare the contract: starknet declare --contract compiled/AtomiqAdapter.json');
      console.log('3. Set ATOMIQ_ADAPTER_CLASS_HASH in .env file');
      console.log('4. Run this script again');
      return;
    }

    const deployResponse = await account.deployContract({
      classHash: classHash,
      constructorCalldata: constructorCalldata
    });

    console.log('⏳ Waiting for deployment confirmation...');
    await provider.waitForTransaction(deployResponse.transaction_hash);

    const contractAddress = deployResponse.contract_address;
    console.log('✅ AtomiqAdapter deployed successfully!');
    console.log('📍 Contract Address:', contractAddress);
    console.log('🔗 Transaction Hash:', deployResponse.transaction_hash);

    // Verify deployment
    console.log('🔍 Verifying deployment...');
    const contract = new Contract(contractAbi, contractAddress, provider);
    
    try {
      const swapCount = await contract.get_swap_count();
      console.log('✅ Contract verification successful. Initial swap count:', swapCount.toString());
    } catch (error) {
      console.log('⚠️  Contract verification failed:', error.message);
    }

    // Save deployment info
    const deploymentInfo = {
      contractAddress: contractAddress,
      transactionHash: deployResponse.transaction_hash,
      classHash: classHash,
      deployedAt: new Date().toISOString(),
      network: process.env.STARKNET_NETWORK || 'mainnet',
      deploymentParams: deploymentParams
    };

    const deploymentFile = path.join(__dirname, '../deployments/atomiq-adapter.json');
    fs.mkdirSync(path.dirname(deploymentFile), { recursive: true });
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    
    console.log('💾 Deployment info saved to:', deploymentFile);

    // Update environment variables
    console.log('\n📝 Add these to your .env file:');
    console.log(`ATOMIQ_ADAPTER_CONTRACT_ADDRESS=${contractAddress}`);
    console.log(`ATOMIQ_ADAPTER_DEPLOYMENT_TX=${deployResponse.transaction_hash}`);

    console.log('\n🎉 AtomiqAdapter deployment complete!');
    console.log('\n📋 Next steps:');
    console.log('1. Update backend configuration with contract address');
    console.log('2. Add STRK token support via add_supported_token()');
    console.log('3. Test swap functionality on testnet first');
    console.log('4. Set up monitoring for swap events');

    return {
      contractAddress,
      transactionHash: deployResponse.transaction_hash,
      deploymentInfo
    };

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    throw error;
  }
}

// Run deployment if called directly
if (require.main === module) {
  deployAtomiqAdapter()
    .then((result) => {
      console.log('✅ Deployment successful:', result.contractAddress);
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Deployment failed:', error);
      process.exit(1);
    });
}

module.exports = { deployAtomiqAdapter };