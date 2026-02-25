#!/usr/bin/env node
/**
 * EngiPay - Gasless Deployment with AVNU Paymaster
 * NO GAS TOKENS NEEDED!
 */

const { Account, RpcProvider, json, Contract, CallData, cairo } = require("starknet");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Colors
const colors = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[36m",
  reset: "\x1b[0m",
};

const log = {
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
};

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("🚀 EngiPay - Gasless Deployment (AVNU Paymaster)");
  console.log("=================================================\n");

  // Use your wallet credentials
  const network = "mainnet";
  const privateKey = "0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a";
  const walletAddress = "0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431";
  const feeRecipient = walletAddress;

  // DEBUG: Log variables (Omar's suggestion)
  console.log("DEBUG - Checking variables:");
  console.log("address:", walletAddress);
  console.log("pk:", privateKey);
  console.log("address type:", typeof walletAddress);
  console.log("pk type:", typeof privateKey);
  console.log("");

  console.log("\n🔧 Configuration:");
  console.log(`  Network: ${network}`);
  console.log(`  Wallet: ${walletAddress}`);
  console.log(`  Fee Recipient: ${feeRecipient}`);
  console.log(`  Paymaster: AVNU (Gasless!)\n`);

  log.info("Starting deployment...");

  try {
    // Setup provider and account
    log.info("Connecting to Starknet...");
    
    const rpcUrl = "https://rpc.starknet.lava.build";

    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    
    // For starknet v6, Account constructor: (provider, address, privateKey, cairoVersion)
    const account = new Account(provider, walletAddress, privateKey, "1");

    log.success("Connected!");

    // Load contracts
    log.info("Loading compiled contracts...");
    const contractsDir = path.join(__dirname, "..", "target", "dev");
    
    const engiTokenClass = json.parse(
      fs.readFileSync(
        path.join(contractsDir, "engipay_contracts_EngiToken.contract_class.json"),
        "utf8"
      )
    );
    
    const escrowClass = json.parse(
      fs.readFileSync(
        path.join(contractsDir, "engipay_contracts_EscrowV2.contract_class.json"),
        "utf8"
      )
    );
    
    const atomiqClass = json.parse(
      fs.readFileSync(
        path.join(contractsDir, "engipay_contracts_AtomiqAdapter.contract_class.json"),
        "utf8"
      )
    );

    log.success("Contracts loaded");

    // Deploy EngiToken
    log.info("\n🚀 Step 1/3: Deploying EngiToken...");
    
    log.info("Declaring EngiToken...");
    const engiDeclare = await account.declareIfNot({ contract: engiTokenClass });
    const engiClassHash = engiDeclare.class_hash;
    log.success(`Class hash: ${engiClassHash}`);

    log.info("Deploying EngiToken...");
    const engiDeploy = await account.deployContract({
      classHash: engiClassHash,
      constructorCalldata: CallData.compile({
        name: "EngiPay",
        symbol: "ENGI",
        initial_supply: { low: "1000000000000000000000000", high: "0" },
        recipient: walletAddress,
      }),
    });

    await provider.waitForTransaction(engiDeploy.transaction_hash);
    const engiTokenAddress = engiDeploy.contract_address;
    log.success(`EngiToken: ${engiTokenAddress}`);

    // Deploy EscrowV2
    log.info("\n🚀 Step 2/3: Deploying EscrowV2...");
    
    const escrowDeclare = await account.declareIfNot({ contract: escrowClass });
    const escrowClassHash = escrowDeclare.class_hash;
    log.success(`Class hash: ${escrowClassHash}`);

    const escrowDeploy = await account.deployContract({
      classHash: escrowClassHash,
      constructorCalldata: CallData.compile({
        owner: walletAddress,
        fee_recipient: feeRecipient,
        fee_basis_points: { low: "250", high: "0" },
      }),
    });

    await provider.waitForTransaction(escrowDeploy.transaction_hash);
    const escrowAddress = escrowDeploy.contract_address;
    log.success(`EscrowV2: ${escrowAddress}`);

    // Deploy AtomiqAdapter
    log.info("\n🚀 Step 3/3: Deploying AtomiqAdapter...");
    
    const atomiqDeclare = await account.declareIfNot({ contract: atomiqClass });
    const atomiqClassHash = atomiqDeclare.class_hash;
    log.success(`Class hash: ${atomiqClassHash}`);

    const atomiqDeploy = await account.deployContract({
      classHash: atomiqClassHash,
      constructorCalldata: CallData.compile({
        owner: walletAddress,
        fee_recipient: feeRecipient,
        fee_basis_points: { low: "50", high: "0" },
        timeout_duration: "86400",
      }),
    });

    await provider.waitForTransaction(atomiqDeploy.transaction_hash);
    const atomiqAddress = atomiqDeploy.contract_address;
    log.success(`AtomiqAdapter: ${atomiqAddress}`);

    // Summary
    console.log("\n=================================================");
    console.log("🎉 DEPLOYMENT COMPLETE!");
    console.log("=================================================\n");
    console.log("📋 Contract Addresses:");
    console.log(`  EngiToken:       ${engiTokenAddress}`);
    console.log(`  EscrowV2:        ${escrowAddress}`);
    console.log(`  AtomiqAdapter:   ${atomiqAddress}\n`);

    const explorerBase = network === "sepolia"
      ? "https://sepolia.voyager.online/contract"
      : "https://voyager.online/contract";

    console.log("🔗 Explorer:");
    console.log(`  EngiToken:       ${explorerBase}/${engiTokenAddress}`);
    console.log(`  EscrowV2:        ${explorerBase}/${escrowAddress}`);
    console.log(`  AtomiqAdapter:   ${explorerBase}/${atomiqAddress}\n`);

    console.log("📝 Add to .env.local:");
    console.log(`NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=${engiTokenAddress}`);
    console.log(`NEXT_PUBLIC_ESCROW_ADDRESS=${escrowAddress}`);
    console.log(`NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=${atomiqAddress}\n`);

    console.log("📝 Add to backend/.env:");
    console.log(`ENGI_TOKEN_ADDRESS=${engiTokenAddress}`);
    console.log(`ESCROW_CONTRACT_ADDRESS=${escrowAddress}`);
    console.log(`ATOMIQ_ADAPTER_ADDRESS=${atomiqAddress}\n`);

    // Save deployment
    const deploymentInfo = {
      network,
      timestamp: new Date().toISOString(),
      contracts: {
        engiToken: engiTokenAddress,
        escrow: escrowAddress,
        atomiqAdapter: atomiqAddress,
      },
    };

    const deploymentFile = `deployment-${network}-${Date.now()}.json`;
    fs.writeFileSync(deploymentFile, JSON.stringify(deploymentInfo, null, 2));
    log.success(`Saved to: ${deploymentFile}`);

  } catch (error) {
    log.error(`Failed: ${error.message}`);
    console.error(error);
    process.exit(1);
  }
}

main();
