# atomiqlabs SDK

A typescript multichain client for atomiqlabs trustlesss cross-chain swaps. Enables trustless swaps between smart chains (Solana, EVM, Starknet, etc.) and bitcoin (on-chain - L1 and lightning network - L2).

Example SDK integration in NodeJS available [here](https://github.com/atomiqlabs/atomiq-sdk-demo)

## Installation
```
npm install @atomiqlabs/sdk@latest
```

## Installing chain-specific connectors

You can install only the chain-specific connectors that your project requires

```
npm install @atomiqlabs/chain-solana@latest
npm install @atomiqlabs/chain-starknet@latest
npm install @atomiqlabs/chain-evm@latest
```

## How to use?

- [Preparations](#preparations)
- [Setting up signers](#signer)
- [Initialization](#initialization)
- Swaps:
  - [Smart Chain -> BTC L1](#swap-smart-chain---bitcoin-on-chain)
  - [BTC L1 -> Solana (Old swap protocol)](#swap-bitcoin-on-chain---solana)
  - [BTC L1 -> Starknet/EVM (New swap protocol)](#swap-bitcoin-on-chain---starknetevm)
  - [Smart Chain -> BTC Lightning network L2](#swap-smart-chain---bitcoin-lightning-network)
  - [Smart Chain -> BTC Lightning network L2 (LNURL-pay)](#swap-smart-chain---bitcoin-lightning-network-1)
  - [BTC Lightning network L2 -> Solana (Old swap protocol)](#swap-bitcoin-lightning-network---solana)
  - [BTC Lightning network L2 -> Starknet/EVM (New swap protocol)](#swap-bitcoin-lightning-network---starknetevm)
  - [BTC Lightning network L2 (LNURL-withdraw) -> Solana (Old swap protocol)](#swap-bitcoin-lightning-network---solana-1)
  - [BTC Lightning network L2 (LNURL-withdraw) -> Starknet/EVM (New swap protocol)](#swap-bitcoin-lightning-network---starknetevm-1)
- [Swap states](#getting-state-of-the-swap)
- [Swap size limits](#swap-size-limits)
- [Stored swaps](#stored-swaps)
  - [Get existing swaps](#get-swap-by-id)
  - [Refundable swaps](#get-refundable-swaps)
  - [Claimable swaps](#get-claimable-swaps)
- [Helpers](#helpers)
  - [Wallet spendable balance](#getting-wallet-balances)
  - [Unified address parsers](#unified-address-parser)
- [Customize swapper instance](#additional-swapper-options)

### Preparations

Set Solana & Starknet RPC URL to use

```typescript
const solanaRpc = "https://api.mainnet-beta.solana.com";
const starknetRpc = "https://starknet-mainnet.public.blastapi.io/rpc/v0_8";
const citreaRpc = "https://rpc.testnet.citrea.xyz";
```

Create swapper factory, here we can pick and choose which chains we want to have supported in the SDK, ensure the "as const" keyword is used such that the typescript compiler can properly infer the types.

```typescript
import {SolanaInitializer, SolanaInitializerType} from "@atomiqlabs/chain-solana";
import {StarknetInitializer, StarknetInitializerType} from "@atomiqlabs/chain-starknet";
import {CitreaInitializer, CitreaInitializerType} from "@atomiqlabs/chain-evm";
import {SwapperFactory} from "@atomiqlabs/sdk";

const Factory = new SwapperFactory<[SolanaInitializerType, StarknetInitializerType, CitreaInitializerType]>([SolanaInitializer, StarknetInitializer, CitreaInitializer] as const);
const Tokens = Factory.Tokens; //Get the supported tokens for all the specified chains.
```

#### Browser

This uses browser's Indexed DB by default

```typescript
import {BitcoinNetwork} from "@atomiqlabs/sdk";

const swapper = Factory.newSwapper({
    chains: {
        SOLANA: {
            rpcUrl: solanaRpc //You can also pass Connection object here
        },
        STARKNET: {
            rpcUrl: starknetRpc //You can also pass Provider object here           
        },
        CITREA: {
            rpcUrl: citreaRpc, //You can also pass JsonApiProvider object here
        }
    },
    bitcoinNetwork: BitcoinNetwork.TESTNET //or BitcoinNetwork.MAINNET, BitcoinNetwork.TESTNET4 - this also sets the network to use for Solana (solana devnet for bitcoin testnet) & Starknet (sepolia for bitcoin testnet)
});
```

if you want to use custom pricing api, mempool.space RPC url, or tune HTTP request timeouts check out [additional options](#additional-swapper-options)

#### NodeJS

For NodeJS we need to use sqlite storage, for that we first need to install the sqlite storage adaptor

```
npm install @atomiqlabs/storage-sqlite@latest
```

Then use pass it in the newSwapper function

```typescript
import {SqliteStorageManager, SqliteUnifiedStorage} from "@atomiqlabs/storage-sqlite";
import {BitcoinNetwork} from "@atomiqlabs/sdk";

const swapper = Factory.newSwapper({
    chains: {
        SOLANA: {
            rpcUrl: solanaRpc //You can also pass Connection object here
        },
        STARKNET: {
            rpcUrl: starknetRpc //You can also pass Provider object here
        },
        CITREA: {
            rpcUrl: citreaRpc, //You can also pass JsonApiProvider object here
        }
    },
    bitcoinNetwork: BitcoinNetwork.TESTNET, //or BitcoinNetwork.MAINNET - this also sets the network to use for Solana (solana devnet for bitcoin testnet) & Starknet (sepolia for bitcoin testnet)
    //The following lines are important for running on backend node.js,
    // because the SDK by default uses browser's Indexed DB
    swapStorage: chainId => new SqliteUnifiedStorage("CHAIN_"+chainId+".sqlite3"),
    chainStorageCtor: name => new SqliteStorageManager("STORE_"+name+".sqlite3"),
});
```

if you want to use custom pricing api, mempool.space RPC url, or tune HTTP request timeouts check out [additional options](#additional-swapper-options)

### Signer

```typescript
import {SolanaSigner} from "@atomiqlabs/chain-solana";
//Browser - react, using solana wallet adapter
const anchorWallet = useAnchorWallet();
const wallet = new SolanaSigner(anchorWallet);
```

```typescript
import {WalletAccount} from "starknet";
import {StarknetSigner} from "@atomiqlabs/chain-starknet";
//Browser, using get-starknet
const swo = await connect();
const wallet = new StarknetBrowserSigner(new WalletAccount(starknetRpc, swo.wallet));
```

or

```typescript
import {Keypair} from "@solana/web3.js";
import {SolanaKeypairWallet, SolanaSigner} from "@atomiqlabs/chain-solana";
//Creating Solana signer from private key
const solanaSigner = new SolanaSigner(new SolanaKeypairWallet(Keypair.fromSecretKey(solanaKey)), Keypair.fromSecretKey(solanaKey));
```

```typescript
import {StarknetSigner, StarknetKeypairWallet} from "@atomiqlabs/chain-starknet";
//Creating Starknet signer from private key
const starknetSigner = new StarknetSigner(new StarknetKeypairWallet(starknetRpc, starknetKey));
```

```typescript
import {BaseWallet, SigningKey} from "ethers";
import {EVMSigner} from "@atomiqlabs/chain-evm";
//Creating EVM signer from private key
const wallet = new BaseWallet(new SigningKey(evmKey));
const evmWallet = new EVMSigner(wallet, wallet.address);
```

### Initialization

Initialize the swapper, this should be done once when your app starts. Checks existing in-progress swaps and does initial LP discovery

```typescript
await swapper.init();
```

Now we have the multichain swapper initialized

### Extract chain-specific swapper with signer

To make it easier to do swaps between bitcoin and a specific chain we can extract a chain-specific swapper, and also set a signer. e.g.:

```typescript
const solanaSwapper = swapper.withChain<"SOLANA">("SOLANA");
```

### Bitcoin on-chain swaps

#### Swap Smart chain -> Bitcoin on-chain

Getting swap quote

```typescript
//Create the swap: swapping SOL to Bitcoin on-chain, receiving _amount of satoshis (smallest unit of bitcoin) to _address
const swap = await swapper.swap(
    Tokens.SOLANA.SOL, //From specified source token
    Tokens.BITCOIN.BTC, //Swap to BTC
    "0.0001", //Amount can be either passed in base units as bigint or in decimal format as string
    SwapAmountType.EXACT_OUT, //EXACT_OUT, so we specify the output amount
    solanaSigner.getAddress(), //Source address and smart chain signer
    "bc1qtw67hj77rt8zrkkg3jgngutu0yfgt9czjwusxt" //BTC address of the recipient
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
const swapSuccessful = await swap.execute(
    solanaSigner,
    { //Callbacks
        onSourceTransactionSent: (txId: string) => {
            //Transaction on the source chain was sent
        },
        onSourceTransactionConfirmed: (txId: string) => {
            //Transaction on the source chain was confirmed
        },
        onSwapSettled: (destinationTxId: string) => {
            //Bitcoin transaction on the destination chain was sent and swap settled
        }
    }
);

//Refund in case of failure
if(!swapSuccessful) {
    //Swap failed, money can be refunded
    await swap.refund(solanaSigner);
} else {
    //Swap successful!
}
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Initiate the swap on the smart-chain side

  - __a.__ Commit with a signer
  ```typescript
  await swap.commit(solanaSigner);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommit = await swap.txsCommit();
  //Sign and send these...
  ...
  //Important to wait till SDK processes the swap initialization
  await swap.waitTillCommited();
  ```

- __2.__ Wait for the swap to execute and for the payment to be sent
  ```typescript
  const swapSuccessful = await swap.waitForPayment();
  ```

- __3.__ In case the swap fails we can refund our funds on the source chain

  - __a.__ Refund with a signer
  ```typescript
  if(!swapSuccessful) {
      await swap.refund(solanaSigner);
      return;
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!swapSuccessful) {
      const txsRefund = await swap.txsRefund();
      //Sign and send these...
      ...
  }
  ```

</details>

<details>
<summary>Swap states</summary>

- ToBTCSwapState.REFUNDED = -3
  - Swap failed and was successfully refunded
- ToBTCSwapState.QUOTE_EXPIRED = -2
  - Swap quote expired and cannot be executed anymore
- ToBTCSwapState.QUOTE_SOFT_EXPIRED = -1
  - Swap quote soft-expired (i.e. the quote probably expired, but if there is already an initialization transaction sent it might still succeed)
- ToBTCSwapState.CREATED = 0
  - Swap quote is created, waiting to be executed
- ToBTCSwapState.COMMITED = 1,
  - Swap was initiated (init transaction sent)
- ToBTCSwapState.SOFT_CLAIMED = 2,
  - Swap was processed by the counterparty but not yet claimed on-chain (bitcoin transaction was sent, but unconfirmed yet)
- ToBTCSwapState.CLAIMED = 3
  - Swap was finished and funds were successfully claimed by the counterparty
- ToBTCSwapState.REFUNDABLE = 4
  - Swap was initiated but counterparty failed to process it, the user can now refund his funds

</details>

#### Swap Bitcoin on-chain -> Solana

NOTE: Solana uses an old swap protocol for Bitcoin on-chain -> Solana swaps, the flow here is different from the one for Starknet and other chains.

Getting swap quote

```typescript
//Create the swap: swapping _amount of satoshis of Bitcoin on-chain to SOL
const swap = await swapper.swap(
    Tokens.BITCOIN.BTC, //Swap from BTC
    Tokens.SOLANA.SOL, //Into specified destination token
    "0.0001", //Amount can be either passed in base units as bigint or in decimal format as string
    SwapAmountType.EXACT_IN, //EXACT_IN, so we specify the input amount
    undefined, //Source address for the swap, not used for swaps from BTC
    solanaSigner.getAddress() //Destination address
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get security deposit amount (Human readable amount of SOL that needs to be put down to rent the liquidity from swap intermediary), you will get this deposit back if the swap succeeds
const securityDeposit: string = swap.getSecurityDeposit().toString();
//Get claimer bounty (Human readable amount of SOL reserved as a reward for watchtowers to claim the swap on your behalf)
const claimerBounty: string = swap.getClaimerBounty().toString();

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
const automaticSettlementSuccess = await swap.execute(
    solanaSigner,
    { //Bitcoin wallet, you can also pass null/undefined and send the bitcoin transaction from an external wallet
        address: "bc1pscnrk588hdj79mwccucu06007mj5np2jurwfwp5mvhkjldzyphzqyk62m5",
        publicKey: "03a2d8b728935f61d5bcba0cfb09c2c443c483b5c31ebd180e1833f37344bd34ba",
        signPsbt: (psbt: {psbt, psbtHex: string, psbtBase64: string}, signInputs: number[]) => {
            //Sign the PSBT with the bitcoin wallet
            ...
            //Return the signed PSBT in the hex or base64 format!
            return "<signed PSBT>";
        }
    },
    { //Callbacks
        onDestinationCommitSent: (swapAddressOpeningTxId: string) => {
            //Swap address opening transaction sent on the destination chain
        },
        onSourceTransactionSent: (txId: string) => {
            //Bitcoin transaction sent on the source
        },
        onSourceTransactionConfirmationStatus: (txId: string, confirmations: number, targetConfirmations: number, txEtaMs: number) => {
            //Bitcoin transaction confirmation status updates
        },
        onSourceTransactionConfirmed: (txId: string) => {
            //Bitcoin transaction confirmed
        },
        onSwapSettled: (destinationTxId: string) => {
            //Swap settled on the destination
        }
    }
);

//In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
if(!automaticSettlementSuccess) {
    await swap.claim(solanaSigner);
}
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Initiate the swap on the destination chain (Solana) by opening up the bitcoin swap address

  - __a.__ Commit using signer
  ```typescript
  await swap.commit(solanaWallet);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommit = await swap.txsCommit();
  //Sign and send these...
  ...
  //Important to wait till SDK processes the swap initialization
  await swap.waitTillCommited();
  ```

- __2.__ Send bitcoin transaction

  - __a.__ Get funded PSBT and sign it 
  ```typescript
    const {psbt, psbtHex, psbtBase64, signInputs} = await swap.getFundedPsbt({
        address: "bc1pscnrk588hdj79mwccucu06007mj5np2jurwfwp5mvhkjldzyphzqyk62m5",
        publicKey: "03a2d8b728935f61d5bcba0cfb09c2c443c483b5c31ebd180e1833f37344bd34ba"
    });
    //Sign the psbt
    const signedPsbt = ...; //Can be hex or base64 encoded
    const bitcoinTxId = await swap.submitPsbt(signedPsbt);
  ```

  - __b.__ Get the bitcoin address or deeplink and send from external wallet
  ```typescript
  //It is imporant to send the EXACT amount, sending different amount will lead to loss of funds!
  const btcSwapAddress = swap.getAddress();
  const btcDeepLink = swap.getHyperlink();
  ```
  
- __3.__ Wait for the bitcoin on-chain transaction to confirm
  ```typescript
  await swap.waitForBitcoinTransaction(
      (txId, confirmations, targetConfirmations, txEtaMs) => {
          //Bitcoin transaction confirmation status callback
      }
  );
  ```

- __4.__ Wait for the automatic settlement of the swap
  ```typescript
  const automaticSettlementSuccess = await swap.waitTillClaimed(30);
  ```

- __5.__ In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain

  - __a.__ Claim with a signer
  ```typescript
  if(!automaticSettlementSuccess) {
      await swap.claim(solanaSigner);
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!automaticSettlementSuccess) {}
      const txsClaim = await swap.txsClaim();
      //Sign and send these...
      ...
      //Important to wait till SDK processes the swap initialization
      await swap.waitTillCommited();
  }
  ```

</details>

<details>
<summary>Swap states</summary>

- FromBTCSwapState.EXPIRED = -3
  - Bitcoin swap address expired
- FromBTCSwapState.QUOTE_EXPIRED = -2
  - Swap quote expired and cannot be executed anymore
- FromBTCSwapState.QUOTE_SOFT_EXPIRED = -1
  - Swap quote soft-expired (i.e. the quote probably expired, but if there is already an initialization transaction sent it might still succeed)
- FromBTCSwapState.PR_CREATED = 0
  - Swap quote is created, waiting for the user to open a bitcoin swap address
- FromBTCSwapState.CLAIM_COMMITED = 1
  - Bitcoin swap address is opened
- FromBTCSwapState.BTC_TX_CONFIRMED = 2
  - Bitcoin transaction sending funds to the swap address is confirmed
- FromBTCSwapState.CLAIM_CLAIMED = 3
  - Swap funds are claimed to the user's wallet

</details>

#### Swap Bitcoin on-chain -> Starknet/EVM

NOTE: Starknet & EVM uses a new swap protocol for Bitcoin on-chain -> Smart chain swaps, the flow here is different from the one for Solana!

Getting swap quote

```typescript
//Create the swap: swapping _amount of satoshis of Bitcoin on-chain to SOL
const swap = await swapper.swap(
    Tokens.BITCOIN.BTC, //Swap from BTC
    Tokens.STARKNET.STRK, //Into specified destination token
    "0.0001", //Amount can be either passed in base units as bigint or in decimal format as string
    SwapAmountType.EXACT_IN, //EXACT_IN, so we specify the input amount
    undefined, //Source address for the swap, not used for swaps from BTC
    starknetSigner.getAddress(), //Destination address
    {
        gasAmount: 1_000_000_000_000_000_000n //We can also request a gas drop on the destination chain (here requesting 1 STRK)
    }
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
const automaticSettlementSuccess = await swap.execute(
    { //Bitcoin wallet
        address: "bc1pscnrk588hdj79mwccucu06007mj5np2jurwfwp5mvhkjldzyphzqyk62m5",
        publicKey: "03a2d8b728935f61d5bcba0cfb09c2c443c483b5c31ebd180e1833f37344bd34ba",
        signPsbt: (psbt: {psbt, psbtHex: string, psbtBase64: string}, signInputs: number[]) => {
            //Sign the PSBT with the bitcoin wallet
            ...
            //Return the signed PSBT in the hex or base64 format!
            return "<signed PSBT>";
        }
    },
    { //Callbacks
        onSourceTransactionSent: (txId: string) => {
            //Bitcoin transaction sent on the source
        },
        onSourceTransactionConfirmationStatus: (txId: string, confirmations: number, targetConfirmations: number, txEtaMs: number) => {
            //Bitcoin transaction confirmation status updates
        },
        onSourceTransactionConfirmed: (txId: string) => {
            //Bitcoin transaction confirmed
        },
        onSwapSettled: (destinationTxId: string) => {
            //Swap settled on the destination
        }
    }
);

//In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
if(!automaticSettlementSuccess) {
    await swap.claim(starknetWallet);
}
```


<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Send bitcoin transaction

  - __a.__ Get funded PSBT and sign it using external wallet (e.g. browser-based like Xverse, Unisat, Phantom, etc.)
  ```typescript
    //Obtain the funded PSBT (input already added) - ready for signing
    const {psbt, psbtHex, psbtBase64, signInputs} = await swap.getFundedPsbt({address: "", publicKey: ""});
    //Pass `psbtBase64` or `psbtHex` (and also `signInputs`) to an external signer like Xverse, Unisat, etc.
    const signedPsbtHexOrBase64 = await <signPsbt function of the external wallet>; //Call the signPsbt function of the external signer with psbtBase64 or psbtHex and signInputs
    //The SDK automatically recognizes hex & base64 encoded PSBTs
    const bitcoinTxId = await swap.submitPsbt(signedPsbtHexOrBase64);
  ```

  - __b.__ Or obtain raw PSBT to which inputs still need to be added
  ```typescript
  const {psbt, psbtHex, psbtBase64, in1sequence} = await swap.getPsbt();
  psbt.addInput(...);
  //Make sure the second input's sequence (index 1) is as specified in the in1sequence variable
  psbt.updateInput(1, {sequence: in1sequence});
  //Sign the PSBT, sign every input except the first one
  for(let i=1;i<psbt.inputsLength; i++) psbt.signIdx(..., i); //Or pass it to external signer
  //Submit the signed PSBT, can be the Transaction object, or hex/base64 serialized
  const bitcoinTxId = await swap.submitPsbt(psbt);
  ```

- __2.__ Wait for the bitcoin on-chain transaction to confirm
  ```typescript
  await swap.waitForBitcoinTransaction(
      (txId, confirmations, targetConfirmations, txEtaMs) => {
          //Bitcoin transaction confirmation status callback
      }
  );
  ```

- __3.__ Wait for the automatic settlement of the swap
  ```typescript
  const automaticSettlementSuccess = await swap.waitTillClaimed(60);
  ```

- __4.__ In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain

  - __a.__ Claim with a signer
  ```typescript
  if(!automaticSettlementSuccess) {
      await swap.claim(starknetSigner);
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!automaticSettlementSuccess) {}
      const txsClaim = await swap.txsClaim();
      //Sign and send these...
      ...
      //Important to wait till SDK processes the swap initialization
      await swap.waitTillCommited();
  }
  ```

</details>

<details>
<summary>Swap states</summary>

- SpvFromBTCSwapState.CLOSED = -5
  - Catastrophic failure during swap, shall never happen
- SpvFromBTCSwapState.FAILED = -4
  - Bitcoin transaction was sent, but was double-spent later, therefore the swap was failed (no BTC was sent)
- SpvFromBTCSwapState.DECLINED = -3
  - LP declined to process the swap transaction, no BTC was sent
- SpvFromBTCSwapState.QUOTE_EXPIRED = -2
  - Swap quote expired and cannot be executed anymore
- SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED = -1
  - Swap quote soft-expired (i.e. the quote probably expired, but if there is a bitcoin transaction being submitted it might still succeed)
- SpvFromBTCSwapState.CREATED = 0
  - Swap quote is created, waiting on user to sign the bitcoin swap transaction
- SpvFromBTCSwapState.SIGNED = 1
  - Bitcoin swap transaction was signed by the client
- SpvFromBTCSwapState.POSTED = 2
  - Bitcoin swap transaction was posted to the LP
- SpvFromBTCSwapState.BROADCASTED = 3
  - LP broadcasted the bitcoin swap transaction
- SpvFromBTCSwapState.FRONTED = 4
  - Swap funds have been deposited to the user's wallet in front of the time
- SpvFromBTCSwapState.BTC_TX_CONFIRMED = 5
  - Bitcoin swap transaction is confirmed
- SpvFromBTCSwapState.CLAIM_CLAIMED = 6
  - Swap funds are claimed to the user's wallet
  - 
</details>

### Bitcoin lightning network swaps

#### Swap Smart chain -> Bitcoin lightning network

Getting swap quote

```typescript
//Create the swap: swapping SOL to Bitcoin lightning
const swap = await swapper.swap(
    Tokens.SOLANA.SOL, //From specified source token
    Tokens.BITCOIN.BTCLN, //Swap to BTC-LN
    undefined, //Amount is specified in the lightning network invoice!
    SwapAmountType.EXACT_OUT, //Make sure we use EXACT_OUT for swaps to BTC-LN, if you want to use EXACT_IN and set an amount, use LNURL-pay!
    solanaSigner.getAddress(), //Source address and smart chain signer
    //Destination lightning network invoice, amount needs to be part of the invoice!
    "lnbc10u1pj2q0g9pp5ejs6m677m39cznpzum7muruvh50ys93ln82p4j9ks2luqm56xxlshp52r2anlhddfa9ex9vpw9gstxujff8a0p8s3pzvua930js0kwfea6scqzzsxqyz5vqsp5073zskc5qfgp7lre0t6s8uexxxey80ax564hsjklfwfjq2ew0ewq9qyyssqvzmgs6f8mvuwgfa9uqxhtza07qem4yfhn9wwlpskccmuwplsqmh8pdy6c42kqdu8p73kky9lsnl40qha5396d8lpgn90y27ltfc5rfqqq59cya"
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
const swapSuccessful = await swap.execute(
    solanaSigner,
    { //Callbacks
        onSourceTransactionSent: (txId: string) => {
            //Transaction on the source chain was sent
        },
        onSourceTransactionConfirmed: (txId: string) => {
            //Transaction on the source chain was confirmed
        },
        onSwapSettled: (destinationTxId: string) => {
            //Lightning payment on the destination chain was sent and swap settled
        }
    }
);

//Refund in case of failure
if(!swapSuccessful) {
    //Swap failed, money can be refunded
    await swap.refund(solanaSigner);
} else {
    //Swap successful!
}
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Initiate the swap on the smart-chain side

  - __a.__ Commit with a signer
  ```typescript
  await swap.commit(solanaSigner);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommit = await swap.txsCommit();
  //Sign and send these...
  ...
  //Important to wait till SDK processes the swap initialization
  await swap.waitTillCommited();
  ```

- __2.__ Wait for the swap to execute and for the payment to be sent
  ```typescript
  const swapSuccessful = await swap.waitForPayment();
  ```

- __3.__ In case the swap fails we can refund our funds on the source chain

  - __a.__ Refund with a signer
  ```typescript
  if(!swapSuccessful) {
      await swap.refund(solanaSigner);
      return;
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!swapSuccessful) {
      const txsRefund = await swap.txsRefund();
      //Sign and send these...
      ...
  }
  ```

</details>

<details>
<summary>Swap states</summary>

- ToBTCSwapState.REFUNDED = -3
    - Swap failed and was successfully refunded
- ToBTCSwapState.QUOTE_EXPIRED = -2
    - Swap quote expired and cannot be executed anymore
- ToBTCSwapState.QUOTE_SOFT_EXPIRED = -1
    - Swap quote soft-expired (i.e. the quote probably expired, but if there is already an initialization transaction sent it might still succeed)
- ToBTCSwapState.CREATED = 0
    - Swap quote is created, waiting to be executed
- ToBTCSwapState.COMMITED = 1,
    - Swap was initiated (init transaction sent)
- ToBTCSwapState.SOFT_CLAIMED = 2,
    - Swap was processed by the counterparty but not yet claimed on-chain (lightning network payment secret was revealed)
- ToBTCSwapState.CLAIMED = 3
    - Swap was finished and funds were successfully claimed by the counterparty
- ToBTCSwapState.REFUNDABLE = 4
    - Swap was initiated but counterparty failed to process it, the user can now refund his funds

</details>

#### Swap Bitcoin lightning network -> Solana

NOTE: Solana uses an old swap protocol for Bitcoin lightning network -> Solana swaps, the flow here is different from the one for Starknet and other chains.

Getting swap quote

```typescript
const swap = await swapper.swap(
    Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
    Tokens.SOLANA.SOL, //Into specified destination token
    10000n, //Amount can be either passed in base units as bigint or in decimal format as string
    SwapAmountType.EXACT_IN, //SwapAmountType.EXACT_IN, so we specify the input amount
    undefined, //Source address for the swap, not used for swaps from BTC-LN
    signer.getAddress() //Destination address
);

//Get the bitcoin lightning network invoice (the invoice contains pre-entered amount)
const receivingLightningInvoice: string = swap.getAddress();
//Get the URI hyperlink (contains the lightning network invoice) which can be displayed also as QR code
const qrCodeData: string = swap.getHyperlink();

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get security deposit amount (Human readable amount of STRK that needs to be put down to rent the liquidity from swap intermediary), you will get this deposit back if the swap succeeds
const securityDeposit: string = swap.getSecurityDeposit().toString();

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
await swap.execute(
    solanaSigner, 
    { //Lightning network wallet, you can also pass null/undefined and pay the LN invoice from an external wallet
        payInvoice: (bolt11PaymentRequest: string) => {
            //Here you would usually call the WebLN or NWC to execute the payment, it's completely fine if the
            // promise here would block till the payment is settled
            return Promise.resolve("");
        }
    },
    { //Callbacks
        onSourceTransactionReceived: (sourceLnPaymentHash: string) => {
            //Lightning network payment received by the LP
        },
        onDestinationCommitSent: (destinationCommitTxId: string) => {
            //HTLC initialization transaction sent on the destination chain
        },
        onDestinationClaimSent: (destinationClaimTxId: string) => {
            //HTLC claim transaction sent on the destination chain
        },
        onSwapSettled: (destinationClaimTxId: string) => {
            //Swap settled and funds received on destination
        }
    }
);
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Pay the LN invoice from a lightning network wallet
  ```typescript
  const lightningInvoice = swap.getAddress();
  ```

- __2.__ Start listening to incoming lightning network payment
  ```typescript
  const success = await swap.waitForPayment();
  if(!success) {
      //Lightning network payment not received in time and quote expired
      return;
  }
  ```

- __3.__ Claim the swap at the destination

  - __a.__ Commit & claim with signer
  ```typescript
  await swap.commitAndClaim(solanaSigner);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommitAndClaim = await swap.txsCommitAndClaim();
  //Take EXTRA care to make sure transaction are sent sequentially and in order - always wait
  // for prior transaction confirmation before sending the next one
  //Sign and send these...
  ...
  ```

</details>

<details>
<summary>Swap states</summary>

- FromBTCLNSwapState.FAILED = -4
  - If the claiming of the funds was initiated, but never concluded, the user will get his lightning network payment refunded
- FromBTCLNSwapState.QUOTE_EXPIRED = -3
  - Swap quote expired and cannot be executed anymore
- FromBTCLNSwapState.QUOTE_SOFT_EXPIRED = -2
  - Swap quote soft-expired (i.e. the quote probably expired, but if there is already an initialization transaction sent it might still succeed)
- FromBTCLNSwapState.EXPIRED = -1
  - Lightning network invoice expired, meaning the swap is expired
- FromBTCLNSwapState.PR_CREATED = 0
  - Swap is created, the user should now pay the provided lightning network invoice
- FromBTCLNSwapState.PR_PAID = 1
  - Lightning network invoice payment was received (but cannot be settled by the counterparty yet)
- FromBTCLNSwapState.CLAIM_COMMITED = 2
  - Claiming of the funds was initiated
- FromBTCLNSwapState.CLAIM_CLAIMED = 3
  - Funds were successfully claimed & lightning network secret pre-image revealed, so the lightning network payment will settle now

</details>

#### Swap Bitcoin lightning network -> Starknet/EVM

Getting swap quote

```typescript
const swap = await swapper.swap(
    Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
    Tokens.STARKNET.STRK, //Into specified destination token
    10000n, //Amount can be either passed in base units as bigint or in decimal format as string
    SwapAmountType.EXACT_IN, //SwapAmountType.EXACT_IN, so we specify the input amount
    undefined, //Source address for the swap, not used for swaps from BTC-LN
    signer.getAddress(), //Destination address
    {
        gasAmount: 1_000_000_000_000_000_000n //We can also request a gas drop on the destination chain (here requesting 1 STRK)
    }
);

//Get the bitcoin lightning network invoice (the invoice contains pre-entered amount)
const receivingLightningInvoice: string = swap.getAddress();
//Get the URI hyperlink (contains the lightning network invoice) which can be displayed also as QR code
const qrCodeData: string = swap.getHyperlink();

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
const automaticSettlementSuccess = await swap.execute(
    { //Lightning network wallet, you can also pass null/undefined and pay the LN invoice from an external wallet
        payInvoice: (bolt11PaymentRequest: string) => {
            //Here you would usually call the WebLN or NWC to execute the payment, it's completely fine if the
            // promise here would block till the payment is settled
            return Promise.resolve("");
        }
    },
    { //Callbacks
        onSourceTransactionReceived: (sourceLnPaymentHash: string) => {
            //Lightning network payment received by the LP
        },
        onSwapSettled: (destinationClaimTxId: string) => {
            //Swap settled and funds received on destination
        }
    }
);

//In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
if(!automaticSettlementSuccess) {
    await swap.claim(starknetSigner);
}
```


<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Pay the LN invoice from a lightning network wallet
  ```typescript
  const lightningInvoice = swap.getAddress();
  ```

- __2.__ Start listening to incoming lightning network payment
  ```typescript
  const success = await swap.waitForPayment();
  if(!success) {
      //Lightning network payment not received in time and quote expired
      return;
  }
  ```

- __3.__ Wait for the swap to be automatically settled
  ```typescript
  const automaticSettlementSuccess = await swap.waitTillClaimed(60);
  ```

- __4.__ In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain

  - __a.__ Claim with signer
  ```typescript
  if(!automaticSettlementSuccess) {
      await swap.claim(starknetSigner);
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!automaticSettlementSuccess) {
      const txsClaim = await swap.txsClaim();
      //Sign and send these...
      ...
  }
  ```

</details>

<details>
<summary>Swap states</summary>

- FromBTCLNAutoSwapState.FAILED = -4
  - If the claiming of the funds was initiated, but never concluded, the user will get his lightning network payment refunded
- FromBTCLNAutoSwapState.QUOTE_EXPIRED = -3
  - Swap quote expired and cannot be executed anymore
- FromBTCLNAutoSwapState.QUOTE_SOFT_EXPIRED = -2
  - Swap quote soft-expired (i.e. the quote probably expired, but if there is already an initialization transaction sent it might still succeed)
- FromBTCLNAutoSwapState.EXPIRED = -1
  - Lightning network invoice expired, meaning the swap is expired
- FromBTCLNAutoSwapState.PR_CREATED = 0
  - Swap is created, the user should now pay the provided lightning network invoice
- FromBTCLNAutoSwapState.PR_PAID = 1
  - Lightning network invoice payment was received (but cannot be settled by the counterparty yet)
- FromBTCLNAutoSwapState.CLAIM_COMMITED = 2
  - A swap HTLC was offered by the LP to the user
- FromBTCLNAutoSwapState.CLAIM_CLAIMED = 3
  - Funds were successfully claimed & lightning network secret pre-image revealed, so the lightning network payment will settle now

</details>

### LNURLs & readable lightning identifiers

LNURLs extend the lightning network functionality by creating static lightning addreses (LNURL-pay & static internet identifiers) and QR codes which allow you to pull funds from them (LNURL-withdraw)

This SDK supports:
* LNURL-pay ([LUD-6](https://github.com/lnurl/luds/blob/luds/06.md), [LUD-9](https://github.com/lnurl/luds/blob/luds/09.md), [LUD-10](https://github.com/lnurl/luds/blob/luds/10.md), [LUD-12](https://github.com/lnurl/luds/blob/luds/12.md))
* LNURL-withdraw ([LUD-3](https://github.com/lnurl/luds/blob/luds/03.md))
* Static internet identifiers ([LUD-16](https://github.com/lnurl/luds/blob/luds/16.md))

You can parse LNURLs and lightning invoices automatically using the [Unified address parser](#unified-address-parser)

#### Differences

Lightning invoices:
* One time use only
* Need to have a fixed amount, therefore recipient has to set the amount
* Static and bounded expiration
* You can only pay to a lightning invoice, not withdraw funds from it

LNURLs & lightning identifiers:
* Reusable
* Programmable expiry
* Allows payer to set an amount
* Supports both, paying (LNURL-pay) and withdrawing (LNURL-withdraw)
* Possibility to attach a message/comment to a payment
* Receive a message/url as a result of the payment

#### Swap Smart chain -> Bitcoin lightning network

Getting swap quote

```typescript
//Create the swap: swapping SOL to Bitcoin lightning
const swap = await swapper.swap(
    Tokens.SOLANA.SOL, //From specified source token
    Tokens.BITCOIN.BTCLN, //Swap to BTC-LN
    10000n, //Now we can specify an amount for a lightning network payment!
    SwapAmountType.EXACT_OUT, //We can also use exactIn=true here and set an amount in input token
    solanaSigner.getAddress(), //Source address and smart chain signer
    //Destination LNURL-pay or readable identifier
    "lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkx6rfvdjx2ctvxyesuk0a27",
    {
        comment: "Hello world" //For LNURL-pay we can also pass a comment to the recipient
    }
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```


Executing the swap (simple)

```typescript
const swapSuccessful = await swap.execute(
    solanaSigner,
    { //Callbacks
        onSourceTransactionSent: (txId: string) => {
            //Transaction on the source chain was sent
        },
        onSourceTransactionConfirmed: (txId: string) => {
            //Transaction on the source chain was confirmed
        },
        onSwapSettled: (destinationTxId: string) => {
            //Lightning payment on the destination chain was sent and swap settled
        }
    }
);

//Refund in case of failure
if(!swapSuccessful) {
    //Swap failed, money can be refunded
    await swap.refund(solanaSigner);
    return;
}

//Swap successful!
const lightningSecret = swap.getSecret();
//In case the LNURL contained a success action, we can read it now and display it to user
if(swap.hasSuccessAction()) {
  //Contains a success action that should displayed to the user
  const successMessage = swap.getSuccessAction();
  const description: string = successMessage.description; //Description of the message
  const text: (string | null) = successMessage.text; //Main text of the message
  const url: (string | null) = successMessage.url; //URL link which should be displayed
}
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Initiate the swap on the smart-chain side

  - __a.__ Commit with a signer
  ```typescript
  await swap.commit(solanaSigner);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommit = await swap.txsCommit();
  //Sign and send these...
  ...
  //Important to wait till SDK processes the swap initialization
  await swap.waitTillCommited();
  ```

- __2.__ Wait for the swap to execute and for the payment to be sent

  ```typescript
  const swapSuccessful = await swap.waitForPayment();
  ```

- __3.__ In case the swap fails we can refund our funds on the source chain

  - __a.__ Refund with a signer
  ```typescript
  if(!swapSuccessful) {
      await swap.refund(solanaSigner);
      return;
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!swapSuccessful) {
      const txsRefund = await swap.txsRefund();
      //Sign and send these...
      ...
  }
  ```

</details>

#### Swap Bitcoin lightning network -> Solana

NOTE: Solana uses an old swap protocol for Bitcoin lightning network -> Solana swaps, the flow here is different from the one for Starknet and other chains.

Getting swap quote

```typescript
const swap = await swapper.swap(
    Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
    Tokens.SOLANA.SOL, //Into specified destination token
    10000n,
    SwapAmountType.EXACT_IN, //EXACT_IN, so we specify the input amount
    //Source LNURL-withdraw link
    "lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkx6rfvdjx2ctvxyesuk0a27",
    signer.getAddress(), //Destination address
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get security deposit amount (Human readable amount of STRK that needs to be put down to rent the liquidity from swap intermediary), you will get this deposit back if the swap succeeds
const securityDeposit: string = swap.getSecurityDeposit().toString();

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```

Executing the swap (simple)

```typescript
await swap.execute(
    solanaSigner, 
    undefined, //No need to specify a wallet, we are sourcing the fund from LNURL-withdraw link
    { //Callbacks
        onSourceTransactionReceived: (sourceLnPaymentHash: string) => {
            //Lightning network payment received by the LP
        },
        onDestinationCommitSent: (destinationCommitTxId: string) => {
            //HTLC initialization transaction sent on the destination chain
        },
        onDestinationClaimSent: (destinationClaimTxId: string) => {
            //HTLC claim transaction sent on the destination chain
        },
        onSwapSettled: (destinationClaimTxId: string) => {
            //Swap settled and funds received on destination
        }
    }
);
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Start listening to incoming lightning network payment (this also requests the payment from LNURL-withdraw service)
  ```typescript
  const success = await swap.waitForPayment();
  if(!success) {
      //Lightning network payment not received in time and quote expired
      return;
  }
  ```

- __2.__ Claim the swap at the destination

  - __a.__ Commit & claim with signer
  ```typescript
  await swap.commitAndClaim(solanaSigner);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommitAndClaim = await swap.txsCommitAndClaim();
  //Take EXTRA care to make sure transaction are sent sequentially and in order - always wait
  // for prior transaction confirmation before sending the next one
  //Sign and send these...
  ...
  ```

</details>

#### Swap Bitcoin lightning network -> Starknet/EVM

Getting swap quote

```typescript
const swap = await swapper.swap(
    Tokens.BITCOIN.BTCLN, //Swap from BTC-LN
    Tokens.STARKNET.STRK, //Into specified destination token
    10000n,
    SwapAmountType.EXACT_IN, //EXACT_IN, so we specify the input amount
    //Source LNURL-withdraw link
    "lnurl1dp68gurn8ghj7ampd3kx2ar0veekzar0wd5xjtnrdakj7tnhv4kxctttdehhwm30d3h82unvwqhkx6rfvdjx2ctvxyesuk0a27",
    signer.getAddress(), //Destination address
    {
        gasAmount: 1_000_000_000_000_000_000n //We can also request a gas drop on the destination chain (here requesting 1 STRK)
    }
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```


Executing the swap (simple)

```typescript
const automaticSettlementSuccess = await swap.execute(
    undefined, //No need to specify a wallet, we are sourcing the funds from LNURL-withdraw link
    { //Callbacks
        onSourceTransactionReceived: (sourceLnPaymentHash: string) => {
            //Lightning network payment received by the LP
        },
        onSwapSettled: (destinationClaimTxId: string) => {
            //Swap settled and funds received on destination
        }
    }
);

//In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain
if(!automaticSettlementSuccess) {
    await swap.claim(starknetSigner);
}
```


<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Start listening to incoming lightning network payment (this also requests the payment from LNURL-withdraw service)
  ```typescript
  const success = await swap.waitForPayment();
  if(!success) {
      //Lightning network payment not received in time and quote expired
      return;
  }
  ```

- __2.__ Wait for the swap to be automatically settled
  ```typescript
  const automaticSettlementSuccess = await swap.waitTillClaimed(60);
  ```

- __3.__ In case the automatic swap settlement fails, we can settle it manually using the wallet of the destination chain

  - __a.__ Claim with signer
  ```typescript
  if(!automaticSettlementSuccess) {
      await swap.claim(starknetSigner);
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!automaticSettlementSuccess) {
      const txsClaim = await swap.txsClaim();
      //Sign and send these...
      ...
  }
  ```

</details>

### Exact-In Smart Chain - Lightning swaps

The main limitation of regular lightning network swaps (Smart chains -> Lightning), is the fact that exactIn swaps are not possible (as invoices need to have a fixed amount). LNURL-pay links solve this issue, but are not supported by all the wallets. Therefore, the SDK exposes a hook/callback that can be implemented by lightning wallets directly, which request fixed amount invoices on-demand. This then makes exact input amount swaps possible. The way it works:

1. SDK sends a request to the LP saying it wants to swap `x` USDC to BTC, with a dummy invoice (either 1 sat or as specified in the `minMsats` parameter - this is requested from the `getInvoice()` function) - this dummy invoice is used to estimate the routing fees by the LP (extra care must be taken for both invoices, dummy and the real one to have the same destination node public key & routing hints).
2. LP responds with the output amount of `y` BTC
3. SDK calls the provided `getInvoice()` callback to request the real invoice for the `y` amount of BTC (in satoshis)
4. SDK forwards the returned fixed amount (`y` BTC) lightning network invoice back to the LP to finish creating the quote

Getting swap quote

```typescript
//Create the swap: swapping SOL to Bitcoin lightning
const swap = await swapper.swap(
    Tokens.SOLANA.SOL, //From specified source token
    Tokens.BITCOIN.BTCLN, //Swap to BTC-LN
    1_000_000_000n, //We can specify an amount for a lightning network payment!
    SwapAmountType.EXACT_IN, //We can use exactIn=true here and set an amount in input token
    solanaSigner.getAddress(), //Source address and smart chain signer
    //Instead of the destination we pass a handler object
    {
        getInvoice: async (amountSats: number, abortSignal?: AbortSignal) => {
            //Generate invoice with fixed amountSats here!
            ...
            return invoice;
        },
        //Optionally you can also specify minimum and maximum in msats (millisatoshis, 1 sat = 1000 msats)
        minMsats: 1_000_000n,
        maxMsats: 1_000_000_000n
    },
    {
        comment: "Hello world" //For LNURL-pay we can also pass a comment to the recipient
    }
);

//Get the amount required to pay and fee
const input: string = swap.getInputWithoutFee().toString(); //Input amount excluding fees
const fee: string = swap.getFee().amountInSrcToken.toString(); //Fees paid on the output
const inputWithFees: string = swap.getInput().toString(); //Total amount paid including fees

const output: string = swap.getOutput().toString(); //Total output amount

//Get swap expiration time
const expiry: number = swap.getQuoteExpiry(); //Expiration time of the swap quote in UNIX milliseconds, swap needs to be initiated before this time

//Get pricing info
const swapPrice = swap.getPriceInfo().swapPrice; //Price of the current swap (excluding fees)
const marketPrice = swap.getPriceInfo().marketPrice; //Current market price
const difference = swap.getPriceInfo().difference; //Difference between the swap price & current market price
```


Executing the swap (simple)

```typescript
const swapSuccessful = await swap.execute(
    solanaSigner,
    { //Callbacks
        onSourceTransactionSent: (txId: string) => {
            //Transaction on the source chain was sent
        },
        onSourceTransactionConfirmed: (txId: string) => {
            //Transaction on the source chain was confirmed
        },
        onSwapSettled: (destinationTxId: string) => {
            //Lightning payment on the destination chain was sent and swap settled
        }
    }
);

//Refund in case of failure
if(!swapSuccessful) {
    //Swap failed, money can be refunded
    await swap.refund(solanaSigner);
    return;
}

//Swap successful!
const lightningSecret = swap.getSecret();
```

<details>
<summary>Manual swap execution (advanced)</summary>

- __1.__ Initiate the swap on the smart-chain side

  - __a.__ Commit with a signer
  ```typescript
  await swap.commit(solanaSigner);
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  const txsCommit = await swap.txsCommit();
  //Sign and send these...
  ...
  //Important to wait till SDK processes the swap initialization
  await swap.waitTillCommited();
  ```

- __2.__ Wait for the swap to execute and for the payment to be sent

  ```typescript
  const swapSuccessful = await swap.waitForPayment();
  ```

- __3.__ In case the swap fails we can refund our funds on the source chain

  - __a.__ Refund with a signer
  ```typescript
  if(!swapSuccessful) {
      await swap.refund(solanaSigner);
      return;
  }
  ```

  - __b.__ Or get the transactions & [sign and send transaction manually](#manually-signing-smart-chain-transactions)
  ```typescript
  if(!swapSuccessful) {
      const txsRefund = await swap.txsRefund();
      //Sign and send these...
      ...
  }
  ```

</details>

### Getting state of the swap

You can get the current state of the swap with:

```typescript
const state = swap.getState();
```

You can also set a listener to listen for swap state changes:

```typescript
swap.events.on("swapState", swap => {
    const newState = swap.getState();
});
```

For the meaning of the states please refer to the "Swap state" section under each swap type.

### Swap size limits

Swap sizes are limited by the LPs you are connected to, they are advertised in BTC terms by LPs during handshake

```typescript
const swapLimits = swapper.getSwapLimits(srcToken, dstToken);
const inputMin = swapLimits.input.min;
const inputMax = swapLimits.input.max;
const outputMin = swapLimits.output.min;
const outputMax = swapLimits.output.max;
```

NOTE: swap limits denominated in BTC are retrieved from the LPs during initial handshake, however limits in other tokens are only returned when getting a quote fails due to amount being too low or too high. For example if you want to get swap limits for the BTC -> SOL swap, the input limits will be immediately available, while the output limits will only get populated once a quote request fails due to amount being too low or high.

```typescript
let swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, Tokens.SOLANA.SOL);
let inputMin = swapLimits.input.min; //Immediately available
let inputMax = swapLimits.input.max; //Immediately available
let outputMin = swapLimits.output.min; //Not available from the get-go
let outputMax = swapLimits.output.max; //Not available from the get-go

//You can also listen to swap limit changes (optional)
swapper.on("swapLimitsChanged", () => {
    //New limits available with swapper.getSwapLimits(srcToken, dstToken)
    //Useful in e.g. a react application where you want to dynamically set min/max swappable amount
})

//Try to swap really small amount of SOL with exactOut swap
try {
    const swap = await swapper.swap(
        Tokens.BITCOIN.BTC, //Swap from BTC
        Tokens.SOLANA.SOL, //Into specified destination token
        1n, //1 lamport = 0.000000001 SOL
        false, //Whether we define an input or output amount
        undefined, //Source address for the swap, not used for swaps from BTC
        solanaSigner.getAddress() //Destination address
    );
} catch (e) {
    //Fails with OutOfBoundsError
}

swapLimits = swapper.getSwapLimits(Tokens.BITCOIN.BTC, Tokens.SOLANA.SOL);
inputMin = swapLimits.input.min; //Immediately available
inputMax = swapLimits.input.max; //Immediately available
outputMin = swapLimits.output.min; //Now available due to failed quote
outputMax = swapLimits.output.max; //Now available due to failed quote
```

### Stored swaps

#### Get swap by ID

You can retrieve a swap by it's id, you can get an ID of the swap with

```typescript
const swapId = swap.getId();
```

And then later retrieve it from the storage

```typescript
const swap = await swapper.getSwapById(id);
```

#### Get refundable swaps
You can refund the swaps in one of two cases:
* In case intermediary is non-cooperative and goes offline, you can claim the funds from the swap contract back after some time.
* In case intermediary tried to pay but was unsuccessful, so he sent you signed message with which you can refund now without waiting.

This call can be checked on every startup and periodically every few minutes.
```typescript
//Get refundable swaps and refund them
const refundableSolanaSwaps = await swapper.getRefundableSwaps("SOLANA", solanaSigner.getAddress());
for(let swap of refundableSolanaSwaps) await swap.refund(solanaSigner);
const refundableStarknetSwaps = await swapper.getRefundableSwaps("STARKNET", starknetSigner.getAddress());
for(let swap of refundableStarknetSwaps) await swap.refund(starknetSigner);
```

#### Get claimable swaps
Returns swaps that are ready to be claimed by the client, this can happen if client closes the application when a swap is in-progress and the swap is concluded while the client is offline.

```typescript
//Get the swaps
const claimableSolanaSwaps = await solanaSwapper.getClaimableSwaps("SOLANA", solanaSigner.getAddress());
//Claim all the claimable swaps
for(let swap of claimableSolanaSwaps) {
    await swap.claim(solanaSigner);
}
//Get the swaps
const claimableStarknetSwaps = await solanaSwapper.getClaimableSwaps("STARKNET", starknetSigner.getAddress());
//Claim all the claimable swaps
for(let swap of claimableStarknetSwaps) {
  await swap.claim(starknetSigner);
}
```

### Helpers

#### Getting wallet balances

The SDK also contains helper functions for getting the maximum spendable balance of wallets

```typescript
//Spendable balance of the starknet wallet address (discounting transaction fees)
const strkBalance = await swapper.Utils.getSpendableBalance(starknetSigner, Tokens.STARKNET.STRK);
//Spendable balance of the solana wallet address (discounting transaction fees)
const solBalance = await swapper.Utils.getSpendableBalance(solanaSigner, Tokens.SOLANA.SOL);
//Spendable balance of the bitcoin wallet - here we also need to specify the destination chain (as there are different swap protocols available with different on-chain footprints)
const {balance: btcBalance, feeRate: btcFeeRate} = await swapper.Utils.getBitcoinSpendableBalance(bitcoinWalletAddress, "SOLANA");
```

#### Unified address parser

A common way for parsing all address formats supported by the SDK, automatically recognizes:
- Bitcoin on-chain L1 address formats (p2pkh, p2wpkh, p2wsh, p2wsh, p2tr)
- [BIP-21](https://en.bitcoin.it/wiki/BIP_0021) bitcoin payment URI
- BOLT11 lightning network invoices
- [LUD-6](https://github.com/lnurl/luds/blob/luds/06.md) LNURL-pay links
- [LUD-3](https://github.com/lnurl/luds/blob/luds/03.md) LNURL-withdraw links
- [LUD-16](https://github.com/lnurl/luds/blob/luds/16.md) Lightning static internet identifiers 
- Smart chain addresses (Solana, Starknet, etc.)

```typescript
const res = await swapper.Utils.parseAddress(address);
switch(res.type) {
  case "BITCOIN":
    //Bitcoin on-chain L1 address or BIP-21 URI scheme with amount
    const btcAmount = res.amount;
    break;
  case "LIGHTNING":
    //BOLT11 lightning network invoice with pre-set amount
    const lnAmount = res.amount;
    break;
  case "LNURL":
    //LNURL payment or withdrawal link
    if(isLNURLWithdraw(res.lnurl)) {
      //LNURL-withdraw allowing withdrawals over the lightning network
      const lnurlWithdrawData: LNURLWithdraw = res.lnurl;
      const minWithdrawable = res.min; //Minimum payment amount
      const maxWithdrawable = res.max; //Maximum payment amount
      const fixedAmount = res.amount; //If res.min===res.max, an fixed amount is returned instead
      //Should show a UI allowing the user to choose an amount he wishes to withdraw
    }
    if(isLNURLPay(res.lnurl)) {
      //LNURL-pay or static lightning internet identifier allowing repeated payments over the lightning network
      const lnurlPayData: LNURLPay = res.lnurl;
      const minPayable = res.min; //Minimum payment amount
      const maxPayable = res.max; //Maximum payment amount
      const fixedAmount = res.amount; //If res.min===res.max, an fixed amount is returned instead
      const icon: (string | null) = res.lnurl.icon; //URL encoded icon that should be displayed on the UI
      const shortDescription: (string | null) = res.lnurl.shortDescription; //Short description of the payment
      const longDescription: (string | null) = res.lnurl.longDescription; //Long description of the payment
      const maxCommentLength: (number | 0) = res.lnurl.commentMaxLength; //Maximum allowed length of the payment message/comment (0 means no comment allowed)
      //Should show a UI displaying the icon, short description, long description, allowing the user to choose an amount he wishes to pay and possibly also a comment
    }
    break;
  default:
    //Addresses for smart chains
    break;
}
```

### Manually signing smart chain transactions

You can also sign the transactions on smart chain side (Solana, Starknet, etc.) of the SDK externally by a separate wallet. Each function which executes any transaction has its txs(action) counterpart, e.g.:
- commit() -> txsCommit()
- claim() -> txsClaim()
- commitAndClaim -> txsCommitAndClaim()
- refund() -> txsRefund()

After sending the transactions, you also need to make sure the SDK has enough time to receive an event notification of the transaction being executed, for this you have the waitTill(action) functions, e.g.:

- commit() -> waitTillCommited()
- claim() -> waitTillClaimed()
- commitAndClaim -> waitTillClaimed()
- refund() -> waitTillRefunded()

```typescript
//Example for Solana
const txns = await swap.txsCommit(); //Also works with txsClaim, txsRefund, txCommitAndClaim
txns.forEach(val => if(val.signers.length>0) { val.tx.sign(...val.signers) });
const signedTransactions = await solanaSigner.wallet.signAllTransactions(txns.map(val => val.tx));
for(let tx of signedTransactions) {
    const res = await solanaRpc.sendRawTransaction(tx.serialize());
    await solanaRpc.confirmTransaction(res);
}
await swap.waitTillCommited(); //Or other relevant waitTillClaimed, waitTillRefunded

//Example for Starknet
const txns = await swap.txsCommit(); //Also works with txsClaim, txsRefund, txCommitAndClaim
for(let tx of txns) {
    if(tx.type==="INVOKE") await starknetSigner.account.execute(tx.tx, tx.details);
    if(tx.type==="DEPLOY_ACCOUNT") await starknetSigner.account.deployAccount(tx.tx, tx.details);
}
await swap.waitTillCommited(); //Or other relevant waitTillClaimed, waitTillRefunded

//Example for EVM
const txns = await swap.txsCommit(); //Also works with txsClaim, txsRefund, txCommitAndClaim
for(let tx of txns) {
  await evmSigner.account.sendTransaction(tx);
}
await swap.waitTillCommited(); //Or other relevant waitTillClaimed, waitTillRefunded
```

### Additional swapper options

You can further customize the swapper instance with these options, you can:
- adjust the maximum accepted pricing difference from the LPs
- use custom mempool.space instance
- use custom pricing API
- use own LP node for swaps
- adjust HTTP request timeouts
- add parameters to be sent with each LP request

```typescript
const swapper = Factory.newSwapper({
    ...
    //Additional optional options
    pricingFeeDifferencePPM: 20000n, //Maximum allowed pricing difference for quote (between swap & market price) in ppm (parts per million) (20000 == 2%)
    mempoolApi: new MempoolApi("<url to custom mempool.space instance>"), //Set the SDK to use a custom mempool.space instance instead of the public one
    getPriceFn: (tickers: string[], abortSignal?: AbortSignal) => customPricingApi.getUsdPriceForTickers(tickers) //Overrides the default pricing API engine with a custom price getter

    intermediaryUrl: "<url to custom LP node>",
    registryUrl: "<url to custom LP node registry>",

    getRequestTimeout: 10000, //Timeout in milliseconds for GET requests
    postRequestTimeout: 10000, //Timeout in milliseconds for POST requests
    defaultAdditionalParameters: {lpData: "Pls give gud price"}, //Additional request data sent to LPs

    defaultTrustedIntermediaryUrl: "<url to custom LP node>" //LP node/intermediary to use for trusted gas swaps
});
```
