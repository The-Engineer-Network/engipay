const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Compiling EngiPay Smart Contract Suite...\n');

// Ensure artifacts directory exists
const artifactsDir = path.join(__dirname, '../artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// All contracts to compile (organized by priority)
const contractGroups = {
  'Core Infrastructure': [
    'interfaces/IERC20.cairo',
    'libraries/SafeMath.cairo',
    'libraries/AccessControl.cairo',
    'libraries/ReentrancyGuard.cairo',
  ],
  'Payment Contracts': [
    'EngiToken.cairo',
    'EscrowV2.cairo',
    'RewardDistributor.cairo',
  ],
  'Governance': [
    'governance/Treasury.cairo',
  ],
  'DeFi Adapters': [
    'adapters/VesuAdapter.cairo',
  ],
  'Cross-Chain': [
    'bridges/CrossChainBridge.cairo',
  ]
};

// Flatten all contracts
const allContracts = [];
Object.values(contractGroups).forEach(group => {
  allContracts.push(...group);
});

let compiledCount = 0;
let skippedCount = 0;
let errorCount = 0;

function compileContract(contractPath) {
  const contractName = path.basename(contractPath, '.cairo');
  const fullPath = path.join(__dirname, '../contracts', contractPath);
  const outputPath = path.join(artifactsDir, contractName);

  // Check if contract file exists
  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  Skipping ${contractPath} - file not found`);
    skippedCount++;
    return false;
  }

  console.log(`📄 Compiling ${contractPath}...`);

  try {
    // Compile Sierra (class) artifact
    execSync(`starknet-compile ${fullPath} --output ${outputPath}.contract_class.json`, {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..')
    });

    // Compile CASM artifact
    execSync(`starknet-compile ${fullPath} --output ${outputPath}.compiled_contract_class.json --casm`, {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..')
    });

    console.log(`✅ ${contractPath} compiled successfully`);
    compiledCount++;
    return true;
  } catch (error) {
    console.error(`❌ Failed to compile ${contractPath}:`);
    console.error(`   ${error.message.split('\n')[0]}`);
    errorCount++;
    return false;
  }
}

// Compile contracts by group
Object.entries(contractGroups).forEach(([groupName, contracts]) => {
  console.log(`\n🏗️  Compiling ${groupName}:`);
  console.log('─'.repeat(50));
  
  contracts.forEach(contractPath => {
    compileContract(contractPath);
  });
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 COMPILATION SUMMARY');
console.log('='.repeat(60));
console.log(`✅ Successfully compiled: ${compiledCount} contracts`);
console.log(`⚠️  Skipped (not found): ${skippedCount} contracts`);
console.log(`❌ Failed to compile: ${errorCount} contracts`);

if (compiledCount > 0) {
  console.log('\n📂 Artifacts generated in: smart-contracts/artifacts/');
  console.log('\n📋 Successfully compiled contracts:');
  
  // List generated artifacts
  const artifacts = fs.readdirSync(artifactsDir).filter(file => file.endsWith('.contract_class.json'));
  artifacts.forEach(artifact => {
    const name = artifact.replace('.contract_class.json', '');
    console.log(`   - ${name}.contract_class.json`);
    console.log(`   - ${name}.compiled_contract_class.json`);
  });
}

if (errorCount > 0) {
  console.log('\n⚠️  COMPILATION ERRORS FOUND');
  console.log('Please fix the errors above before deployment.');
  console.log('Common issues:');
  console.log('   - Missing dependencies or imports');
  console.log('   - Syntax errors in Cairo code');
  console.log('   - Outdated Cairo compiler version');
  console.log('   - Missing interface implementations');
}

if (skippedCount > 0) {
  console.log('\n📝 MISSING CONTRACTS');
  console.log('The following contracts need to be implemented:');
  
  allContracts.forEach(contractPath => {
    const fullPath = path.join(__dirname, '../contracts', contractPath);
    if (!fs.existsSync(fullPath)) {
      console.log(`   - ${contractPath}`);
    }
  });
  
  console.log('\nRefer to COMPLETE_SMART_CONTRACT_SUITE.md for implementation details.');
}

console.log('\n🎯 NEXT STEPS:');
if (compiledCount > 0) {
  console.log('   1. 🚀 Ready for deployment! Run: npm run deploy:sepolia');
  console.log('   2. 🧪 Test on Sepolia testnet first');
  console.log('   3. 🔍 Verify contracts on StarkScan');
  console.log('   4. 🔒 Get security audit before mainnet');
}

if (errorCount > 0 || skippedCount > 0) {
  console.log('   1. 🔧 Fix compilation errors');
  console.log('   2. 📝 Implement missing contracts');
  console.log('   3. 🔄 Run compilation again');
}

console.log('\n💡 TIP: Use --verbose flag for detailed compilation output');

// Exit with error code if there were compilation failures
if (errorCount > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 Compilation completed successfully!');
}