require("@shardlabs/starknet-hardhat-plugin");

module.exports = {
  starknet: {
    venv: "active",
    network: "devnet",
    wallets: {
      user1: {
        accountName: "user1",
        modulePath: "starkware.starknet.wallets.open_zeppelin.OpenZeppelinAccount",
        accountPath: "~/.starknet_accounts"
      }
    }
  },
  networks: {
    devnet: {
      url: "http://127.0.0.1:5050"
    },
    testnet: {
      url: "https://alpha4.starknet.io"
    },
    mainnet: {
      url: "https://alpha-mainnet.starknet.io"
    }
  },
  mocha: {
    timeout: 40000
  }
};