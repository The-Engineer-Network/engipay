const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Compiling StarkNet contracts...\n');

// Ensure artifacts directory exists
const artifactsDir = path.join(__dirname, '../artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// Contracts to compile
const contracts = [
  'EngiToken.cairo',
  'Escrow.cairo',
  'RewardDistributor.cairo'
];

contracts.forEach(contractName => {
  const contractPath = path.join(__dirname, '../contracts', contractName);
  const outputPath = path.join(artifactsDir, contractName.replace('.cairo', ''));

  console.log(`📄 Compiling ${contractName}...`);

  try {
    // Compile Sierra (class) artifact
    execSync(`starknet-compile ${contractPath} --output ${outputPath}.contract_class.json`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    // Compile CASM artifact
    execSync(`starknet-compile ${contractPath} --output ${outputPath}.compiled_contract_class.json --casm`, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..')
    });

    console.log(`✅ ${contractName} compiled successfully\n`);
  } catch (error) {
    console.error(`❌ Failed to compile ${contractName}:`, error.message);
    process.exit(1);
  }
});

console.log('🎉 All contracts compiled successfully!');
console.log('\n📂 Artifacts generated in: smart-contracts/artifacts/');
console.log('\n📋 Generated files:');
contracts.forEach(contract => {
  const name = contract.replace('.cairo', '');
  console.log(`   - ${name}.contract_class.json`);
  console.log(`   - ${name}.compiled_contract_class.json`);
});

console.log('\n🚀 Ready for deployment! Run: npm run deploy');