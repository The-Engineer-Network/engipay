#!/usr/bin/env node
/**
 * Check if everything is ready for deployment
 */

const fs = require("fs");
const path = require("path");

const colors = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[36m",
  reset: "\x1b[0m",
};

console.log("\n🔍 EngiPay Deployment Readiness Check\n");
console.log("=====================================\n");

let allGood = true;

// Check 1: Compiled contracts
console.log("📦 Checking compiled contracts...");
const contractsDir = path.join(__dirname, "..", "target", "dev");
const requiredContracts = [
  "engipay_contracts_EngiToken.contract_class.json",
  "engipay_contracts_EscrowV2.contract_class.json",
  "engipay_contracts_AtomiqAdapter.contract_class.json",
];

requiredContracts.forEach((contract) => {
  const contractPath = path.join(contractsDir, contract);
  if (fs.existsSync(contractPath)) {
    console.log(`${colors.green}  ✅ ${contract}${colors.reset}`);
  } else {
    console.log(`${colors.red}  ❌ ${contract} - NOT FOUND${colors.reset}`);
    allGood = false;
  }
});

// Check 2: Node modules
console.log("\n📚 Checking dependencies...");
const nodeModulesPath = path.join(__dirname, "..", "..", "node_modules");

const requiredPackages = [
  "starknet",
  "@starkware-ecosystem/starkzap",
];

requiredPackages.forEach((pkg) => {
  const pkgPath = path.join(nodeModulesPath, pkg);
  if (fs.existsSync(pkgPath)) {
    console.log(`${colors.green}  ✅ ${pkg}${colors.reset}`);
  } else {
    console.log(`${colors.red}  ❌ ${pkg} - NOT INSTALLED${colors.reset}`);
    allGood = false;
  }
});

// Check 3: Deployment script
console.log("\n📝 Checking deployment scripts...");
const deployScript = path.join(__dirname, "deploy-gasless.js");
if (fs.existsSync(deployScript)) {
  console.log(`${colors.green}  ✅ deploy-gasless.js${colors.reset}`);
} else {
  console.log(`${colors.red}  ❌ deploy-gasless.js - NOT FOUND${colors.reset}`);
  allGood = false;
}

// Summary
console.log("\n=====================================\n");

if (allGood) {
  console.log(`${colors.green}🎉 ALL CHECKS PASSED!${colors.reset}`);
  console.log("\nYou're ready to deploy! Run:");
  console.log(`${colors.blue}  node deploy-gasless.js${colors.reset}\n`);
} else {
  console.log(`${colors.red}❌ SOME CHECKS FAILED${colors.reset}`);
  console.log("\nTo fix:");
  console.log("1. Compile contracts:");
  console.log("   cd smart-contracts && scarb build");
  console.log("2. Install dependencies:");
  console.log("   npm install\n");
}

process.exit(allGood ? 0 : 1);
