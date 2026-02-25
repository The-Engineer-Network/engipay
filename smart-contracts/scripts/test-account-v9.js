const { Account, RpcProvider, constants } = require("starknet");

const walletAddress = "0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431";
const privateKey = "0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a";

console.log("Testing starknet.js v9 Account creation...\n");
console.log("Wallet:", walletAddress);
console.log("Private Key:", privateKey);
console.log("Types:", typeof walletAddress, typeof privateKey);
console.log("\nConstants available:", Object.keys(constants));

const provider = new RpcProvider({ 
  nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7" 
});

console.log("\n✅ Provider created");

try {
  // Try with cairoVersion parameter
  const account = new Account(provider, walletAddress, privateKey, "1");
  console.log("✅ Account created with cairoVersion!");
  console.log("Address:", account.address);
} catch (error) {
  console.log("❌ Error with cairoVersion:", error.message);
  
  try {
    // Try without cairoVersion
    const account = new Account(provider, walletAddress, privateKey);
    console.log("✅ Account created without cairoVersion!");
    console.log("Address:", account.address);
  } catch (error2) {
    console.log("❌ Error without cairoVersion:", error2.message);
    console.error(error2);
  }
}
