const { Account, RpcProvider, Signer } = require("starknet");

const walletAddress = "0x0138C47B025Ee61025fB19B6718b0d6c77Bd2420c7d298018B80aDC10d6fD431";
const privateKey = "0x06bf4e0ba3e4a19017bb806f860b3406b31538afa34e8c7ca8bbd8d51988e22a";

console.log("Wallet:", walletAddress);
console.log("Private Key:", privateKey);

const provider = new RpcProvider({ nodeUrl: "https://starknet-sepolia.public.blastapi.io/rpc/v0_7" });

try {
  // Try with Signer
  const signer = new Signer(privateKey);
  const account = new Account(provider, walletAddress, signer);
  console.log("✅ Account created successfully!");
  console.log("Address:", account.address);
} catch (error) {
  console.error("❌ Error:", error.message);
  console.error(error);
}
