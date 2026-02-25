#!/usr/bin/env node
const {
  StarkSDK,
  StarkSigner,
  OnboardStrategy,
} = require("@starkware-ecosystem/starkzap");
const fs = require("fs");
const path = require("path");

const WALLET_ADDRESS = "0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431";
const PRIVATE_KEY = "0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a";

console.log("\n🚀 EngiPay Deployment with StarkZap SDK\n");

async function main() {
  try {
    // Initialize StarkZap SDK
    console.log("✅ Initializing StarkZap SDK...");
    const sdk = new StarkSDK({ network: "sepolia" });

    // Onboard wallet
    console.log("✅ Connecting wallet...");
    const { wallet } = await sdk.onboard({
      strategy: OnboardStrategy.Signer,
      account: { signer: new StarkSigner(PRIVATE_KEY) },
      deploy: "if_needed",
    });

    console.log(`✅ Wallet connected: ${wallet.address}\n`);
    console.log("🎉 StarkZap SDK is working!\n");
    console.log("Now we can use this to deploy contracts...");

  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error);
  }
}

main();
