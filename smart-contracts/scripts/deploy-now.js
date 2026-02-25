#!/usr/bin/env node
const { Account, RpcProvider, json, CallData } = require("starknet");
const fs = require("fs");
const path = require("path");

// Your wallet credentials
const WALLET_ADDRESS = "0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431";
const PRIVATE_KEY = "0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a";
const NETWORK = "sepolia"; // Change to "mainnet" when ready

console.log("\n🚀 EngiPay Deployment Starting...\n");
console.log(`Network: ${NETWORK}`);
console.log(`Wallet: ${WALLET_ADDRESS}\n`);

async function main() {
  try {
    // Setup
    const rpcUrl = NETWORK === "sepolia"
      ? "https://starknet-sepolia.public.blastapi.io/rpc/v0_7"
      : "https://starknet-mainnet.public.blastapi.io/rpc/v0_7";

    const provider = new RpcProvider({ nodeUrl: rpcUrl });
    
    // For starknet v6, Account needs cairoVersion parameter
    const account = new Account(provider, WALLET_ADDRESS, PRIVATE_KEY);
    account.cairoVersion = "1";

    console.log("✅ Connected to Starknet\n");

    // Load contracts
    const contractsDir = path.join(__dirname, "..", "target", "dev");
    
    const engiTokenClass = json.parse(
      fs.readFileSync(path.join(contractsDir, "engipay_contracts_EngiToken.contract_class.json"), "utf8")
    );
    
    const escrowClass = json.parse(
      fs.readFileSync(path.join(contractsDir, "engipay_contracts_EscrowV2.contract_class.json"), "utf8")
    );
    
    const atomiqClass = json.parse(
      fs.readFileSync(path.join(contractsDir, "engipay_contracts_AtomiqAdapter.contract_class.json"), "utf8")
    );

    console.log("✅ Contracts loaded\n");

    // Deploy EngiToken
    console.log("🚀 Deploying EngiToken...");
    const engiDeclare = await account.declareIfNot({ contract: engiTokenClass });
    console.log(`   Class hash: ${engiDeclare.class_hash}`);

    const engiDeploy = await account.deployContract({
      classHash: engiDeclare.class_hash,
      constructorCalldata: CallData.compile({
        name: "EngiPay",
        symbol: "ENGI",
        initial_supply: { low: "1000000000000000000000000", high: "0" },
        recipient: WALLET_ADDRESS,
      }),
    });

    await provider.waitForTransaction(engiDeploy.transaction_hash);
    console.log(`✅ EngiToken: ${engiDeploy.contract_address}\n`);

    // Deploy EscrowV2
    console.log("🚀 Deploying EscrowV2...");
    const escrowDeclare = await account.declareIfNot({ contract: escrowClass });
    console.log(`   Class hash: ${escrowDeclare.class_hash}`);

    const escrowDeploy = await account.deployContract({
      classHash: escrowDeclare.class_hash,
      constructorCalldata: CallData.compile({
        owner: WALLET_ADDRESS,
        fee_recipient: WALLET_ADDRESS,
        fee_basis_points: { low: "250", high: "0" },
      }),
    });

    await provider.waitForTransaction(escrowDeploy.transaction_hash);
    console.log(`✅ EscrowV2: ${escrowDeploy.contract_address}\n`);

    // Deploy AtomiqAdapter
    console.log("🚀 Deploying AtomiqAdapter...");
    const atomiqDeclare = await account.declareIfNot({ contract: atomiqClass });
    console.log(`   Class hash: ${atomiqDeclare.class_hash}`);

    const atomiqDeploy = await account.deployContract({
      classHash: atomiqDeclare.class_hash,
      constructorCalldata: CallData.compile({
        owner: WALLET_ADDRESS,
        fee_recipient: WALLET_ADDRESS,
        fee_basis_points: { low: "50", high: "0" },
        timeout_duration: "86400",
      }),
    });

    await provider.waitForTransaction(atomiqDeploy.transaction_hash);
    console.log(`✅ AtomiqAdapter: ${atomiqDeploy.contract_address}\n`);

    // Summary
    console.log("===========================================");
    console.log("🎉 DEPLOYMENT COMPLETE!");
    console.log("===========================================\n");
    console.log("📋 Contract Addresses:\n");
    console.log(`EngiToken:       ${engiDeploy.contract_address}`);
    console.log(`EscrowV2:        ${escrowDeploy.contract_address}`);
    console.log(`AtomiqAdapter:   ${atomiqDeploy.contract_address}\n`);

    const explorerBase = NETWORK === "sepolia"
      ? "https://sepolia.voyager.online/contract"
      : "https://voyager.online/contract";

    console.log("🔗 Voyager Links:\n");
    console.log(`${explorerBase}/${engiDeploy.contract_address}`);
    console.log(`${explorerBase}/${escrowDeploy.contract_address}`);
    console.log(`${explorerBase}/${atomiqDeploy.contract_address}\n`);

    console.log("📝 Add to .env.local:\n");
    console.log(`NEXT_PUBLIC_ENGI_TOKEN_ADDRESS=${engiDeploy.contract_address}`);
    console.log(`NEXT_PUBLIC_ESCROW_ADDRESS=${escrowDeploy.contract_address}`);
    console.log(`NEXT_PUBLIC_ATOMIQ_ADAPTER_ADDRESS=${atomiqDeploy.contract_address}\n`);

    // Save
    const deploymentInfo = {
      network: NETWORK,
      timestamp: new Date().toISOString(),
      contracts: {
        engiToken: engiDeploy.contract_address,
        escrow: escrowDeploy.contract_address,
        atomiqAdapter: atomiqDeploy.contract_address,
      },
    };

    fs.writeFileSync("deployment.json", JSON.stringify(deploymentInfo, null, 2));
    console.log("✅ Saved to deployment.json\n");

  } catch (error) {
    console.error("\n❌ Deployment failed:", error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
