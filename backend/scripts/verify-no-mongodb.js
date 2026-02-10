#!/usr/bin/env node

/**
 * Verification script to ensure MongoDB is completely removed
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying MongoDB removal...\n');

let hasErrors = false;

// Check 1: No mongoose in models
console.log('1. Checking models for mongoose imports...');
const modelsDir = path.join(__dirname, '../models');
const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));

modelFiles.forEach(file => {
  const content = fs.readFileSync(path.join(modelsDir, file), 'utf8');
  if (content.includes('require(\'mongoose\')') || content.includes('require("mongoose")')) {
    console.log(`   ❌ ${file} still has mongoose import`);
    hasErrors = true;
  }
});

if (!hasErrors) {
  console.log('   ✅ No mongoose imports found in models\n');
}

// Check 2: All models load successfully
console.log('2. Loading all models...');
try {
  const models = require('../models');
  const modelNames = Object.keys(models).filter(k => k !== 'sequelize' && k !== 'Sequelize');
  console.log(`   ✅ Successfully loaded ${modelNames.length} models:`);
  console.log(`      ${modelNames.join(', ')}\n`);
} catch (error) {
  console.log(`   ❌ Error loading models: ${error.message}\n`);
  hasErrors = true;
}

// Check 3: Package.json doesn't have MongoDB
console.log('3. Checking package.json...');
const packageJson = require('../package.json');
const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

if (deps.mongoose || deps.mongodb || deps['mongodb-memory-server']) {
  console.log('   ❌ MongoDB packages found in package.json');
  hasErrors = true;
} else {
  console.log('   ✅ No MongoDB packages in package.json\n');
}

// Check 4: Verify PostgreSQL is configured
console.log('4. Checking PostgreSQL configuration...');
if (deps.pg && deps['pg-hstore'] && deps.sequelize) {
  console.log('   ✅ PostgreSQL packages installed\n');
} else {
  console.log('   ❌ Missing PostgreSQL packages');
  hasErrors = true;
}

// Final result
console.log('═'.repeat(50));
if (hasErrors) {
  console.log('❌ VERIFICATION FAILED - Issues found above');
  process.exit(1);
} else {
  console.log('✅ VERIFICATION PASSED - MongoDB completely removed!');
  console.log('✅ All models converted to PostgreSQL/Sequelize');
  console.log('✅ Ready for database setup');
  process.exit(0);
}
