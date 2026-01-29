import {
    BitcoinRpc,
    BtcTx,
    RelaySynchronizer,
    SpvVaultContract,
    SpvVaultTokenData,
    SpvWithdrawalState,
    SpvWithdrawalStateType,
    SpvWithdrawalTransactionData,
    TransactionConfirmationOptions
} from "@atomiqlabs/base";
import {Buffer} from "buffer";
import {StarknetTx} from "../chain/modules/StarknetTransactions";
import {StarknetContractBase} from "../contract/StarknetContractBase";
import {StarknetChainInterface} from "../chain/StarknetChainInterface";
import {StarknetBtcRelay} from "../btcrelay/StarknetBtcRelay";
import {cairo, constants, merkle} from "starknet";
import {StarknetAction} from "../chain/StarknetAction";
import {SpvVaultContractAbi} from "./SpvVaultContractAbi";
import {StarknetSigner} from "../wallet/StarknetSigner";
import {StarknetSpvVaultData} from "./StarknetSpvVaultData";
import {StarknetSpvWithdrawalData} from "./StarknetSpvWithdrawalData";
import {bigNumberishToBuffer, bufferToByteArray, bufferToU32Array, getLogger, toBigInt, toHex} from "../../utils/Utils";
import {StarknetBtcStoredHeader} from "../btcrelay/headers/StarknetBtcStoredHeader";
import {StarknetAddresses} from "../chain/modules/StarknetAddresses";
import {StarknetFees} from "../chain/modules/StarknetFees";
import {toBig} from "@noble/hashes/_u64";
import {StarknetAbiEvent} from "../contract/modules/StarknetContractEvents";
import {ExtractAbiEventNames} from "abi-wan-kanabi/dist/kanabi";

const spvVaultContractAddreses = {
    [constants.StarknetChainId.SN_SEPOLIA]: "0x02d581ea838cd5ca46ba08660eddd064d50a0392f618e95310432147928d572e",
    [constants.StarknetChainId.SN_MAIN]: "0x01932042992647771f3d0aa6ee526e65359c891fe05a285faaf4d3ffa373e132"
};

const STARK_PRIME_MOD: bigint = 2n**251n + 17n * 2n**192n + 1n;

function decodeUtxo(utxo: string): {txHash: bigint, vout: bigint} {
    const [txId, vout] = utxo.split(":");
    return {
        txHash: BigInt("0x"+Buffer.from(txId, "hex").reverse().toString("hex")),
        vout: BigInt(vout)
    }
}

export class StarknetSpvVaultContract
    extends StarknetContractBase<typeof SpvVaultContractAbi>
    implements SpvVaultContract<
        StarknetTx,
        StarknetSigner,
        "STARKNET",
        StarknetSpvVaultData,
        StarknetSpvWithdrawalData
    >
{
    private static readonly GasCosts = {
        DEPOSIT: {l1DataGas: 400, l2Gas: 4_000_000, l1Gas: 0},
        OPEN: {l1DataGas: 1200, l2Gas: 3_200_000, l1Gas: 0},
        FRONT: {l1DataGas: 800, l2Gas: 12_000_000, l1Gas: 0},
        CLAIM: {l1DataGas: 1000, l2Gas: 400_000_000, l1Gas: 0},
        CLAIM_OPTIMISTIC_ESTIMATE: {l1DataGas: 1000, l2Gas: 80_000_000, l1Gas: 0} //If claimer uses sierra 1.7.0 or later
    };

    readonly chainId = "STARKNET";

    readonly btcRelay: StarknetBtcRelay<any>;
    readonly bitcoinRpc: BitcoinRpc<any>;
    readonly claimTimeout: number = 180;
    readonly maxClaimsPerTx: number = 10;

    readonly logger = getLogger("StarknetSpvVaultContract: ");

    constructor(
        chainInterface: StarknetChainInterface,
        btcRelay: StarknetBtcRelay<any>,
        bitcoinRpc: BitcoinRpc<any>,
        contractAddress: string = spvVaultContractAddreses[chainInterface.starknetChainId]
    ) {
        super(chainInterface, contractAddress, SpvVaultContractAbi);
        this.btcRelay = btcRelay;
        this.bitcoinRpc = bitcoinRpc;
    }

    //StarknetActions
    protected Open(signer: string, vault: StarknetSpvVaultData): StarknetAction {
        const {txHash, vout} = decodeUtxo(vault.getUtxo());

        const tokens = vault.getTokenData();
        if(tokens.length!==2) throw new Error("Must specify exactly 2 tokens for vault!");

        return new StarknetAction(signer, this.Chain,
            this.contract.populateTransaction.open(
                vault.getVaultId(), this.btcRelay.contract.address,
                cairo.tuple(cairo.uint256(txHash), vout), vault.getConfirmations(),
                tokens[0].token, tokens[1].token, tokens[0].multiplier, tokens[1].multiplier
            ),
            StarknetSpvVaultContract.GasCosts.OPEN
        );
    }

    protected Deposit(signer: string, vault: StarknetSpvVaultData, rawAmounts: bigint[]): StarknetAction {
        return new StarknetAction(signer, this.Chain,
            this.contract.populateTransaction.deposit(vault.getOwner(), vault.getVaultId(), rawAmounts[0], rawAmounts[1] ?? 0n),
            StarknetSpvVaultContract.GasCosts.DEPOSIT
        );
    }

    protected Front(signer: string, vault: StarknetSpvVaultData, data: StarknetSpvWithdrawalData, withdrawalSequence: number) {
        return new StarknetAction(signer, this.Chain,
            this.contract.populateTransaction.front(
                vault.getOwner(), vault.getVaultId(), BigInt(withdrawalSequence),
                data.getTxHash(), data.serializeToStruct()
            ),
            StarknetSpvVaultContract.GasCosts.FRONT
        );
    }

    protected Claim(
        signer: string, vault: StarknetSpvVaultData, data: StarknetSpvWithdrawalData,
        blockheader: StarknetBtcStoredHeader, merkle: Buffer[], position: number
    ) {
        return new StarknetAction(signer, this.Chain,
            {
                contractAddress: this.contract.address,
                entrypoint: "claim",
                calldata: [
                    vault.getOwner(),
                    vault.getVaultId(),
                    ...bufferToByteArray(Buffer.from(data.btcTx.hex, "hex")),
                    ...blockheader.serialize(),
                    merkle.length,
                    ...merkle.map(bufferToU32Array).flat(),
                    position,
                ].map(val => toHex(val, 0))
            },
            StarknetSpvVaultContract.GasCosts.CLAIM
        );
    }

    async checkWithdrawalTx(tx: SpvWithdrawalTransactionData): Promise<void> {
        const result = await this.Chain.provider.callContract({
            contractAddress: this.contract.address,
            entrypoint: "parse_bitcoin_tx",
            calldata: bufferToByteArray(Buffer.from(tx.btcTx.hex, "hex"))
        });
        if(result==null) throw new Error("Failed to parse transaction!");
    }

    createVaultData(owner: string, vaultId: bigint, utxo: string, confirmations: number, tokenData: SpvVaultTokenData[]): Promise<StarknetSpvVaultData> {
        if(tokenData.length!==2) throw new Error("Must specify 2 tokens in tokenData!");
        return Promise.resolve(new StarknetSpvVaultData(owner, vaultId, {
            relay_contract: this.btcRelay.contract.address,
            token_0: tokenData[0].token,
            token_1: tokenData[1].token,
            token_0_multiplier: tokenData[0].multiplier,
            token_1_multiplier: tokenData[1].multiplier,
            utxo: cairo.tuple(cairo.uint256(0), 0),
            confirmations: confirmations,
            withdraw_count: 0,
            deposit_count: 0,
            token_0_amount: 0n,
            token_1_amount: 0n
        }, utxo));
    }

    //Getters
    async getVaultData(owner: string, vaultId: bigint): Promise<StarknetSpvVaultData> {
        const struct = await this.contract.get_vault(owner, vaultId);
        if(toHex(struct.relay_contract)!==toHex(this.btcRelay.contract.address)) return null;
        return new StarknetSpvVaultData(owner, vaultId, struct);
    }

    async getMultipleVaultData(vaults: {owner: string, vaultId: bigint}[]): Promise<{[owner: string]: {[vaultId: string]: StarknetSpvVaultData}}> {
        const result: {[owner: string]: {[vaultId: string]: StarknetSpvVaultData}} = {};
        let promises: Promise<void>[] = [];
        //TODO: We can upgrade this to use multicall
        for(let {owner, vaultId} of vaults) {
            promises.push(this.getVaultData(owner, vaultId).then(val => {
                result[owner] ??= {};
                result[owner][vaultId.toString(10)] = val;
            }));
            if(promises.length>=this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }

    async getVaultLatestUtxo(owner: string, vaultId: bigint): Promise<string | null> {
        const vault = await this.getVaultData(owner, vaultId);
        if(vault==null) return null;
        if(!vault.isOpened()) return null;
        return vault.getUtxo();
    }

    async getVaultLatestUtxos(vaults: {owner: string, vaultId: bigint}[]): Promise<{[owner: string]: {[vaultId: string]: string | null}}> {
        const result: {[owner: string]: {[vaultId: string]: string | null}} = {};
        let promises: Promise<void>[] = [];
        //TODO: We can upgrade this to use multicall
        for(let {owner, vaultId} of vaults) {
            promises.push(this.getVaultLatestUtxo(owner, vaultId).then(val => {
                result[owner] ??= {};
                result[owner][vaultId.toString(10)] = val;
            }));
            if(promises.length>=this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }

    async getAllVaults(owner?: string): Promise<StarknetSpvVaultData[]> {
        const openedVaults = new Set<string>();
        await this.Events.findInContractEventsForward(
            ["spv_swap_vault::events::Opened", "spv_swap_vault::events::Closed"],
            owner==null ? null : [null, owner],
            (event) => {
                const owner = toHex(event.params.owner);
                const vaultId = toBigInt(event.params.vault_id);
                const vaultIdentifier = owner+":"+vaultId.toString(10);
                if(event.name==="spv_swap_vault::events::Opened") {
                    openedVaults.add(vaultIdentifier);
                } else {
                    openedVaults.delete(vaultIdentifier);
                }
                return null;
            }
        );
        const vaults: StarknetSpvVaultData[] = [];
        for(let identifier of openedVaults.keys()) {
            const [owner, vaultIdStr] = identifier.split(":");
            const vaultData = await this.getVaultData(owner, BigInt(vaultIdStr));
            if(vaultData!=null) vaults.push(vaultData);
        }
        return vaults;
    }

    async getFronterAddress(owner: string, vaultId: bigint, withdrawal: StarknetSpvWithdrawalData): Promise<string | null> {
        const fronterAddress = await this.contract.get_fronter_address_by_id(owner, vaultId, "0x"+withdrawal.getFrontingId());
        if(toHex(fronterAddress, 64)==="0x0000000000000000000000000000000000000000000000000000000000000000") return null;
        return fronterAddress;
    }

    async getFronterAddresses(withdrawals: {owner: string, vaultId: bigint, withdrawal: StarknetSpvWithdrawalData}[]): Promise<{[btcTxId: string]: string | null}> {
        const result: {
            [btcTxId: string]: string | null
        } = {};
        let promises: Promise<void>[] = [];
        //TODO: We can upgrade this to use multicall
        for(let {owner, vaultId, withdrawal} of withdrawals) {
            promises.push(this.getFronterAddress(owner, vaultId, withdrawal).then(val => {
                result[withdrawal.getTxId()] = val;
            }));
            if(promises.length>=this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }

    private parseWithdrawalEvent(event: StarknetAbiEvent<typeof SpvVaultContractAbi, "spv_swap_vault::events::Claimed" | "spv_swap_vault::events::Fronted" | "spv_swap_vault::events::Closed">): SpvWithdrawalState | null {
        switch(event.name) {
            case "spv_swap_vault::events::Fronted":
                return {
                    type: SpvWithdrawalStateType.FRONTED,
                    txId: event.txHash,
                    owner: toHex(event.params.owner),
                    vaultId: toBigInt(event.params.vault_id),
                    recipient: toHex(event.params.recipient),
                    fronter: toHex(event.params.fronting_address)
                };
            case "spv_swap_vault::events::Claimed":
                return {
                    type: SpvWithdrawalStateType.CLAIMED,
                    txId: event.txHash,
                    owner: toHex(event.params.owner),
                    vaultId: toBigInt(event.params.vault_id),
                    recipient: toHex(event.params.recipient),
                    claimer: toHex(event.params.caller),
                    fronter: toHex(event.params.fronting_address)
                };
            case "spv_swap_vault::events::Closed":
                return {
                    type: SpvWithdrawalStateType.CLOSED,
                    txId: event.txHash,
                    owner: toHex(event.params.owner),
                    vaultId: toBigInt(event.params.vault_id),
                    error: bigNumberishToBuffer(event.params.error).toString()
                };
            default:
                return null;
        }
    }

    async getWithdrawalStates(withdrawalTxs: {withdrawal: StarknetSpvWithdrawalData, scStartBlockheight?: number}[]): Promise<{[btcTxId: string]: SpvWithdrawalState}> {
        const result: {[btcTxId: string]: SpvWithdrawalState} = {};
        withdrawalTxs.forEach(withdrawalTx => {
            result[withdrawalTx.withdrawal.getTxId()] = {
                type: SpvWithdrawalStateType.NOT_FOUND
            };
        });

        const events: ["spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed", "spv_swap_vault::events::Closed"] =
            ["spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed", "spv_swap_vault::events::Closed"];

        for(let i=0;i<withdrawalTxs.length;i+=this.Chain.config.maxGetLogKeys) {
            const checkWithdrawalTxs = withdrawalTxs.slice(i, i+this.Chain.config.maxGetLogKeys);
            const lows: string[] = [];
            const highs: string[] = [];
            let startHeight: number = undefined;
            checkWithdrawalTxs.forEach(withdrawalTx => {
                const txHash = Buffer.from(withdrawalTx.withdrawal.getTxId(), "hex").reverse();
                const txHashU256 = cairo.uint256("0x"+txHash.toString("hex"));
                lows.push(toHex(txHashU256.low));
                highs.push(toHex(txHashU256.high));
                if(startHeight!==null) {
                    if(withdrawalTx.scStartBlockheight==null) {
                        startHeight = null;
                    } else {
                        startHeight = Math.min(startHeight ?? Infinity, withdrawalTx.scStartBlockheight);
                    }
                }
            });

            await this.Events.findInContractEventsForward(
                events,[lows, highs],
                async (event) => {
                    const txId = bigNumberishToBuffer(event.params.btc_tx_hash, 32).reverse().toString("hex");
                    if(result[txId]==null) {
                        this.logger.warn(`getWithdrawalStates(): findInContractEvents-callback: loaded event for ${txId}, but transaction not found in input params!`)
                        return;
                    }
                    const eventResult = this.parseWithdrawalEvent(event);
                    if(eventResult!=null) result[txId] = eventResult;
                },
                startHeight
            );
        }

        return result;
    }

    async getWithdrawalState(withdrawalTx: StarknetSpvWithdrawalData, scStartBlockheight?: number): Promise<SpvWithdrawalState> {
        const txHash = Buffer.from(withdrawalTx.getTxId(), "hex").reverse();
        const txHashU256 = cairo.uint256("0x"+txHash.toString("hex"));
        let result: SpvWithdrawalState = {
            type: SpvWithdrawalStateType.NOT_FOUND
        };
        const events: ["spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed", "spv_swap_vault::events::Closed"] =
            ["spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed", "spv_swap_vault::events::Closed"];
        const keys = [toHex(txHashU256.low), toHex(txHashU256.high)];

        await this.Events.findInContractEventsForward(
            events, keys,
            async (event) => {
                const eventResult = this.parseWithdrawalEvent(event);
                if(eventResult!=null) result = eventResult;
            },
            scStartBlockheight
        );
        return result;
    }

    getWithdrawalData(btcTx: BtcTx): Promise<StarknetSpvWithdrawalData> {
        return Promise.resolve(new StarknetSpvWithdrawalData(btcTx));
    }

    //OP_RETURN data encoding/decoding
    fromOpReturnData(data: Buffer): { recipient: string; rawAmounts: bigint[]; executionHash: string } {
        return StarknetSpvVaultContract.fromOpReturnData(data);
    }
    static fromOpReturnData(data: Buffer): { recipient: string; rawAmounts: bigint[]; executionHash: string } {
        let rawAmount0: bigint = 0n;
        let rawAmount1: bigint = 0n;
        let executionHash: string = null;
        if(data.length===40) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
        } else if(data.length===48) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
            rawAmount1 = data.readBigInt64LE(40).valueOf();
        } else if(data.length===72) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
            executionHash = data.slice(40, 72).toString("hex");
        } else if(data.length===80) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
            rawAmount1 = data.readBigInt64LE(40).valueOf();
            executionHash = data.slice(48, 80).toString("hex");
        } else {
            throw new Error("Invalid OP_RETURN data length!");
        }

        if(executionHash!=null) {
            const executionHashValue = BigInt("0x"+executionHash);
            if(executionHashValue >= STARK_PRIME_MOD) throw new Error("Execution hash not in range of starknet prime");
        }

        const recipient = "0x"+data.slice(0, 32).toString("hex");
        if(!StarknetAddresses.isValidAddress(recipient)) throw new Error("Invalid recipient specified");

        return {executionHash, rawAmounts: [rawAmount0, rawAmount1], recipient};
    }

    toOpReturnData(recipient: string, rawAmounts: bigint[], executionHash?: string): Buffer {
        return StarknetSpvVaultContract.toOpReturnData(recipient, rawAmounts, executionHash);
    }
    static toOpReturnData(recipient: string, rawAmounts: bigint[], executionHash?: string): Buffer {
        if(!StarknetAddresses.isValidAddress(recipient)) throw new Error("Invalid recipient specified");
        if(rawAmounts.length < 1) throw new Error("At least 1 amount needs to be specified");
        if(rawAmounts.length > 2) throw new Error("At most 2 amounts need to be specified");
        rawAmounts.forEach(val => {
            if(val < 0n) throw new Error("Negative raw amount specified");
            if(val >= 2n**64n) throw new Error("Raw amount overflow");
        });
        if(executionHash!=null) {
            const executionHashValue = toBigInt(executionHash);
            if(executionHashValue < 0n) throw new Error("Execution hash negative");
            if(executionHashValue >= STARK_PRIME_MOD) throw new Error("Execution hash not in range of starknet prime");
        }
        const recipientBuffer = Buffer.from(recipient.substring(2).padStart(64, "0"), "hex");
        const amount0Buffer = Buffer.from(rawAmounts[0].toString(16).padStart(16, "0"), "hex");
        const amount1Buffer = rawAmounts[1]==null || rawAmounts[1]===0n ? Buffer.alloc(0) : Buffer.from(rawAmounts[1].toString(16).padStart(16, "0"), "hex");
        const executionHashBuffer = executionHash==null ? Buffer.alloc(0) : Buffer.from(executionHash.substring(2).padStart(64, "0"), "hex");

        return Buffer.concat([
            recipientBuffer,
            amount0Buffer.reverse(),
            amount1Buffer.reverse(),
            executionHashBuffer
        ]);
    }

    //Actions
    async claim(signer: StarknetSigner, vault: StarknetSpvVaultData, txs: {tx: StarknetSpvWithdrawalData, storedHeader?: StarknetBtcStoredHeader}[], synchronizer?: RelaySynchronizer<any, any, any>, initAta?: boolean, txOptions?: TransactionConfirmationOptions): Promise<string> {
        const result = await this.txsClaim(signer.getAddress(), vault, txs, synchronizer, initAta, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }

    async deposit(signer: StarknetSigner, vault: StarknetSpvVaultData, rawAmounts: bigint[], txOptions?: TransactionConfirmationOptions): Promise<string> {
        const result = await this.txsDeposit(signer.getAddress(), vault, rawAmounts, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }

    async frontLiquidity(signer: StarknetSigner, vault: StarknetSpvVaultData, realWithdrawalTx: StarknetSpvWithdrawalData, withdrawSequence: number, txOptions?: TransactionConfirmationOptions): Promise<string> {
        const result = await this.txsFrontLiquidity(signer.getAddress(), vault, realWithdrawalTx, withdrawSequence, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }

    async open(signer: StarknetSigner, vault: StarknetSpvVaultData, txOptions?: TransactionConfirmationOptions): Promise<string> {
        const result = await this.txsOpen(signer.getAddress(), vault, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }

    //Transactions
    async txsClaim(
        signer: string, vault: StarknetSpvVaultData, txs: {
            tx: StarknetSpvWithdrawalData,
            storedHeader?: StarknetBtcStoredHeader
        }[], synchronizer?: RelaySynchronizer<any, any, any>,
        initAta?: boolean, feeRate?: string
    ): Promise<StarknetTx[]> {
        if(!vault.isOpened()) throw new Error("Cannot claim from a closed vault!");
        feeRate ??= await this.Chain.Fees.getFeeRate();

        const txsWithMerkleProofs: {
            tx: StarknetSpvWithdrawalData,
            reversedTxId: Buffer,
            pos: number,
            blockheight: number,
            merkle: Buffer[],
            storedHeader?: StarknetBtcStoredHeader
        }[] = [];
        for(let tx of txs) {
            const merkleProof = await this.bitcoinRpc.getMerkleProof(tx.tx.btcTx.txid, tx.tx.btcTx.blockhash);
            this.logger.debug("txsClaim(): merkle proof computed: ", merkleProof);
            txsWithMerkleProofs.push({
                ...merkleProof,
                ...tx
            });
        }

        const starknetTxs: StarknetTx[] = [];
        const storedHeaders: {[blockhash: string]: StarknetBtcStoredHeader} = await StarknetBtcRelay.getCommitedHeadersAndSynchronize(
            signer, this.btcRelay, txsWithMerkleProofs.filter(tx => tx.storedHeader==null).map(tx => {
                return {
                    blockhash: tx.tx.btcTx.blockhash,
                    blockheight: tx.blockheight,
                    requiredConfirmations: vault.getConfirmations()
                }
            }), starknetTxs, synchronizer, feeRate
        );
        if(storedHeaders==null) throw new Error("Cannot fetch committed header!");

        const actions = txsWithMerkleProofs.map(tx => {
            return this.Claim(signer, vault, tx.tx, tx.storedHeader ?? storedHeaders[tx.tx.btcTx.blockhash], tx.merkle, tx.pos);
        });

        let starknetAction = new StarknetAction(signer, this.Chain);
        for(let action of actions) {
            starknetAction.add(action);
            if(starknetAction.ixsLength() >= this.maxClaimsPerTx) {
                await starknetAction.addToTxs(starknetTxs, feeRate);
                starknetAction = new StarknetAction(signer, this.Chain);
            }
        }
        if(starknetAction.ixsLength() > 0) {
            await starknetAction.addToTxs(starknetTxs, feeRate);
        }

        this.logger.debug("txsClaim(): "+starknetTxs.length+" claim TXs created claiming "+txs.length+" txs, owner: "+vault.getOwner()+
            " vaultId: "+vault.getVaultId().toString(10));

        return starknetTxs;
    }

    async txsDeposit(signer: string, vault: StarknetSpvVaultData, rawAmounts: bigint[], feeRate?: string): Promise<StarknetTx[]> {
        if(!vault.isOpened()) throw new Error("Cannot deposit to a closed vault!");
        //Approve first
        const vaultTokens = vault.getTokenData();
        const action = new StarknetAction(signer, this.Chain);
        let realAmount0 = 0n;
        let realAmount1 = 0n;
        if(rawAmounts[0]!=null && rawAmounts[0]!==0n) {
            realAmount0 = rawAmounts[0] * vaultTokens[0].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[0].token, realAmount0));
        }
        if(rawAmounts[1]!=null && rawAmounts[1]!==0n) {
            realAmount1 = rawAmounts[1] * vaultTokens[1].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[1].token, realAmount1));
        }
        action.add(this.Deposit(signer, vault, rawAmounts));

        feeRate ??= await this.Chain.Fees.getFeeRate();

        this.logger.debug("txsDeposit(): deposit TX created,"+
            " token0: "+vaultTokens[0].token+" rawAmount0: "+rawAmounts[0].toString(10)+" amount0: "+realAmount0.toString(10)+
            " token1: "+vaultTokens[1].token+" rawAmount1: "+(rawAmounts[1] ?? 0n).toString(10)+" amount1: "+realAmount1.toString(10));

        return [await action.tx(feeRate)];
    }

    async txsFrontLiquidity(signer: string, vault: StarknetSpvVaultData, realWithdrawalTx: StarknetSpvWithdrawalData, withdrawSequence: number, feeRate?: string): Promise<StarknetTx[]> {
        if(!vault.isOpened()) throw new Error("Cannot front on a closed vault!");

        //Approve first
        const vaultTokens = vault.getTokenData();
        const action = new StarknetAction(signer, this.Chain);
        const rawAmounts = realWithdrawalTx.getFrontingAmount();
        let realAmount0 = 0n;
        let realAmount1 = 0n;
        if(rawAmounts[0]!=null && rawAmounts[0]!==0n) {
            realAmount0 = rawAmounts[0] * vaultTokens[0].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[0].token, realAmount0));
        }
        if(rawAmounts[1]!=null && rawAmounts[1]!==0n) {
            realAmount1 = rawAmounts[1] * vaultTokens[1].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[1].token, realAmount1));
        }
        action.add(this.Front(signer, vault, realWithdrawalTx, withdrawSequence));

        feeRate ??= await this.Chain.Fees.getFeeRate();

        this.logger.debug("txsFrontLiquidity(): front TX created,"+
            " token0: "+vaultTokens[0].token+" rawAmount0: "+rawAmounts[0].toString(10)+" amount0: "+realAmount0.toString(10)+
            " token1: "+vaultTokens[1].token+" rawAmount1: "+(rawAmounts[1] ?? 0n).toString(10)+" amount1: "+realAmount1.toString(10));

        return [await action.tx(feeRate)];
    }

    async txsOpen(signer: string, vault: StarknetSpvVaultData, feeRate?: string): Promise<StarknetTx[]> {
        if(vault.isOpened()) throw new Error("Cannot open an already opened vault!");

        const action = this.Open(signer, vault);

        feeRate ??= await this.Chain.Fees.getFeeRate();

        this.logger.debug("txsOpen(): open TX created, owner: "+vault.getOwner()+
            " vaultId: "+vault.getVaultId().toString(10));

        return [await action.tx(feeRate)];
    }

    async getClaimFee(signer: string, vault: StarknetSpvVaultData, withdrawalData: StarknetSpvWithdrawalData, feeRate?: string): Promise<bigint> {
        feeRate ??= await this.Chain.Fees.getFeeRate();
        return StarknetFees.getGasFee(
            withdrawalData==null ? StarknetSpvVaultContract.GasCosts.CLAIM_OPTIMISTIC_ESTIMATE : StarknetSpvVaultContract.GasCosts.CLAIM,
            feeRate
        );
    }

    async getFrontFee(signer: string, vault: StarknetSpvVaultData, withdrawalData: StarknetSpvWithdrawalData, feeRate?: string): Promise<bigint> {
        feeRate ??= await this.Chain.Fees.getFeeRate();
        return StarknetFees.getGasFee(StarknetSpvVaultContract.GasCosts.FRONT, feeRate);
    }

}
