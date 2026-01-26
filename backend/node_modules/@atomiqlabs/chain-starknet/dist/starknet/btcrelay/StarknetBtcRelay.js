"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetBtcRelay = void 0;
const buffer_1 = require("buffer");
const StarknetBtcHeader_1 = require("./headers/StarknetBtcHeader");
const base_1 = require("@atomiqlabs/base");
const Utils_1 = require("../../utils/Utils");
const StarknetContractBase_1 = require("../contract/StarknetContractBase");
const StarknetBtcStoredHeader_1 = require("./headers/StarknetBtcStoredHeader");
const BtcRelayAbi_1 = require("./BtcRelayAbi");
const starknet_1 = require("starknet");
const StarknetFees_1 = require("../chain/modules/StarknetFees");
const StarknetAction_1 = require("../chain/StarknetAction");
function serializeBlockHeader(e) {
    return new StarknetBtcHeader_1.StarknetBtcHeader({
        reversed_version: (0, Utils_1.u32ReverseEndianness)(e.getVersion()),
        previous_blockhash: (0, Utils_1.bufferToU32Array)(buffer_1.Buffer.from(e.getPrevBlockhash(), "hex").reverse()),
        merkle_root: (0, Utils_1.bufferToU32Array)(buffer_1.Buffer.from(e.getMerkleRoot(), "hex").reverse()),
        reversed_timestamp: (0, Utils_1.u32ReverseEndianness)(e.getTimestamp()),
        nbits: (0, Utils_1.u32ReverseEndianness)(e.getNbits()),
        nonce: (0, Utils_1.u32ReverseEndianness)(e.getNonce()),
        hash: buffer_1.Buffer.from(e.getHash(), "hex").reverse()
    });
}
const GAS_PER_BLOCKHEADER = { l1DataGas: 600, l2Gas: 24000000, l1Gas: 0 };
const GAS_PER_BLOCKHEADER_FORK = { l1DataGas: 1000, l2Gas: 40000000, l1Gas: 0 };
const btcRelayAddreses = {
    [base_1.BitcoinNetwork.TESTNET4]: "0x0099b63f39f0cabb767361de3d8d3e97212351a51540e2687c2571f4da490dbe",
    [base_1.BitcoinNetwork.TESTNET]: "0x068601c79da2231d21e015ccfd59c243861156fa523a12c9f987ec28eb8dbc8c",
    [base_1.BitcoinNetwork.MAINNET]: "0x057b14a4231b82f1e525ff35a722d893ca3dd2bde0baa6cee97937c5be861dbc"
};
function serializeCalldata(headers, storedHeader, span) {
    span.push((0, Utils_1.toHex)(headers.length));
    headers.forEach(header => {
        span.push(...header.serialize());
    });
    span.push(...storedHeader.serialize());
    return span;
}
const logger = (0, Utils_1.getLogger)("StarknetBtcRelay: ");
class StarknetBtcRelay extends StarknetContractBase_1.StarknetContractBase {
    SaveMainHeaders(signer, mainHeaders, storedHeader) {
        return new StarknetAction_1.StarknetAction(signer, this.Chain, {
            contractAddress: this.contract.address,
            entrypoint: "submit_main_blockheaders",
            calldata: serializeCalldata(mainHeaders, storedHeader, [])
        }, (0, StarknetFees_1.starknetGasMul)(GAS_PER_BLOCKHEADER, mainHeaders.length));
    }
    SaveShortForkHeaders(signer, forkHeaders, storedHeader) {
        return new StarknetAction_1.StarknetAction(signer, this.Chain, {
            contractAddress: this.contract.address,
            entrypoint: "submit_short_fork_blockheaders",
            calldata: serializeCalldata(forkHeaders, storedHeader, [])
        }, (0, StarknetFees_1.starknetGasMul)(GAS_PER_BLOCKHEADER, forkHeaders.length));
    }
    SaveLongForkHeaders(signer, forkId, forkHeaders, storedHeader, totalForkHeaders = 100) {
        return new StarknetAction_1.StarknetAction(signer, this.Chain, {
            contractAddress: this.contract.address,
            entrypoint: "submit_fork_blockheaders",
            calldata: serializeCalldata(forkHeaders, storedHeader, [(0, Utils_1.toHex)(forkId)])
        }, (0, StarknetFees_1.starknetGasAdd)((0, StarknetFees_1.starknetGasMul)(GAS_PER_BLOCKHEADER, forkHeaders.length), (0, StarknetFees_1.starknetGasMul)(GAS_PER_BLOCKHEADER_FORK, totalForkHeaders)));
    }
    constructor(chainInterface, bitcoinRpc, bitcoinNetwork, contractAddress = btcRelayAddreses[bitcoinNetwork]) {
        super(chainInterface, contractAddress, BtcRelayAbi_1.BtcRelayAbi);
        this.maxHeadersPerTx = 40;
        this.maxForkHeadersPerTx = 30;
        this.maxShortForkHeadersPerTx = 40;
        this.bitcoinRpc = bitcoinRpc;
    }
    /**
     * Computes subsequent commited headers as they will appear on the blockchain when transactions
     *  are submitted & confirmed
     *
     * @param initialStoredHeader
     * @param syncedHeaders
     * @private
     */
    computeCommitedHeaders(initialStoredHeader, syncedHeaders) {
        const computedCommitedHeaders = [initialStoredHeader];
        for (let blockHeader of syncedHeaders) {
            computedCommitedHeaders.push(computedCommitedHeaders[computedCommitedHeaders.length - 1].computeNext(blockHeader));
        }
        return computedCommitedHeaders;
    }
    /**
     * A common logic for submitting blockheaders in a transaction
     *
     * @param signer
     * @param headers headers to sync to the btc relay
     * @param storedHeader current latest stored block header for a given fork
     * @param tipWork work of the current tip in a given fork
     * @param forkId forkId to submit to, forkId=0 means main chain, forkId=-1 means short fork
     * @param feeRate feeRate for the transaction
     * @private
     */
    async _saveHeaders(signer, headers, storedHeader, tipWork, forkId, feeRate) {
        const blockHeaderObj = headers.map(serializeBlockHeader);
        let starknetAction;
        switch (forkId) {
            case -1:
                starknetAction = this.SaveShortForkHeaders(signer, blockHeaderObj, storedHeader);
                break;
            case 0:
                starknetAction = this.SaveMainHeaders(signer, blockHeaderObj, storedHeader);
                break;
            default:
                starknetAction = this.SaveLongForkHeaders(signer, forkId, blockHeaderObj, storedHeader);
                break;
        }
        const tx = await starknetAction.tx(feeRate);
        const computedCommitedHeaders = this.computeCommitedHeaders(storedHeader, blockHeaderObj);
        const lastStoredHeader = computedCommitedHeaders[computedCommitedHeaders.length - 1];
        if (forkId !== 0 && base_1.StatePredictorUtils.gtBuffer(lastStoredHeader.getChainWork(), tipWork)) {
            //Fork's work is higher than main chain's work, this fork will become a main chain
            forkId = 0;
        }
        return {
            forkId: forkId,
            lastStoredHeader,
            tx,
            computedCommitedHeaders
        };
    }
    getBlock(commitHash, blockHash) {
        const keys = [commitHash == null ? null : (0, Utils_1.toHex)(commitHash)];
        if (blockHash != null) {
            const starknetBlockHash = starknet_1.hash.computePoseidonHashOnElements((0, Utils_1.bufferToU32Array)(buffer_1.Buffer.from([...blockHash]).reverse()));
            keys.push(starknetBlockHash);
        }
        return this.Events.findInContractEvents(["btc_relay::events::StoreHeader", "btc_relay::events::StoreForkHeader"], keys, (event) => {
            return Promise.resolve([StarknetBtcStoredHeader_1.StarknetBtcStoredHeader.fromSerializedFeltArray(event.data), BigInt(event.params.commit_hash)]);
        });
    }
    async getBlockHeight() {
        return Number(await this.contract.get_blockheight());
    }
    /**
     * Returns data about current main chain tip stored in the btc relay
     */
    async getTipData() {
        const commitHash = await this.contract.get_tip_commit_hash();
        if (commitHash == null || BigInt(commitHash) === BigInt(0))
            return null;
        const result = await this.getBlock(commitHash);
        if (result == null)
            return null;
        const [storedBlockHeader] = result;
        return {
            blockheight: storedBlockHeader.getBlockheight(),
            commitHash: (0, Utils_1.bigNumberishToBuffer)(commitHash, 32).toString("hex"),
            blockhash: storedBlockHeader.getBlockHash().toString("hex"),
            chainWork: storedBlockHeader.getChainWork()
        };
    }
    /**
     * Retrieves blockheader with a specific blockhash, returns null if requiredBlockheight is provided and
     *  btc relay contract is not synced up to the desired blockheight
     *
     * @param blockData
     * @param requiredBlockheight
     */
    async retrieveLogAndBlockheight(blockData, requiredBlockheight) {
        //TODO: we can fetch the blockheight and events in parallel
        const blockHeight = await this.getBlockHeight();
        if (requiredBlockheight != null && blockHeight < requiredBlockheight) {
            return null;
        }
        const result = await this.getBlock(null, buffer_1.Buffer.from(blockData.blockhash, "hex"));
        if (result == null)
            return null;
        const [storedBlockHeader, commitHash] = result;
        //Check if block is part of the main chain
        const chainCommitment = await this.contract.get_commit_hash(storedBlockHeader.block_height);
        if (BigInt(chainCommitment) !== BigInt(commitHash))
            return null;
        logger.debug("retrieveLogAndBlockheight(): block found," +
            " commit hash: " + (0, Utils_1.toHex)(commitHash) + " blockhash: " + blockData.blockhash + " current btc relay height: " + blockHeight);
        return { header: storedBlockHeader, height: blockHeight };
    }
    /**
     * Retrieves blockheader data by blockheader's commit hash,
     *
     * @param commitmentHashStr
     * @param blockData
     */
    async retrieveLogByCommitHash(commitmentHashStr, blockData) {
        const result = await this.getBlock(commitmentHashStr, buffer_1.Buffer.from(blockData.blockhash, "hex"));
        if (result == null)
            return null;
        const [storedBlockHeader, commitHash] = result;
        //Check if block is part of the main chain
        const chainCommitment = await this.contract.get_commit_hash(storedBlockHeader.block_height);
        if (BigInt(chainCommitment) !== BigInt(commitHash))
            return null;
        logger.debug("retrieveLogByCommitHash(): block found," +
            " commit hash: " + commitmentHashStr + " blockhash: " + blockData.blockhash + " height: " + storedBlockHeader.block_height);
        return storedBlockHeader;
    }
    /**
     * Retrieves latest known stored blockheader & blockheader from bitcoin RPC that is in the main chain
     */
    async retrieveLatestKnownBlockLog() {
        const data = await this.Events.findInContractEvents(["btc_relay::events::StoreHeader", "btc_relay::events::StoreForkHeader"], null, async (event) => {
            const storedHeader = StarknetBtcStoredHeader_1.StarknetBtcStoredHeader.fromSerializedFeltArray(event.data);
            const blockHashHex = storedHeader.getBlockHash().toString("hex");
            const commitHash = event.params.commit_hash;
            const [isInBtcMainChain, btcRelayCommitHash] = await Promise.all([
                this.bitcoinRpc.isInMainChain(blockHashHex).catch(() => false),
                this.contract.get_commit_hash(storedHeader.block_height)
            ]);
            if (!isInBtcMainChain)
                return null;
            if (BigInt(commitHash) !== BigInt(btcRelayCommitHash))
                return null;
            return {
                resultStoredHeader: storedHeader,
                resultBitcoinHeader: await this.bitcoinRpc.getBlockHeader(blockHashHex),
                commitHash: commitHash
            };
        });
        if (data != null)
            logger.debug("retrieveLatestKnownBlockLog(): block found," +
                " commit hash: " + (0, Utils_1.toHex)(data.commitHash) + " blockhash: " + data.resultBitcoinHeader.getHash() +
                " height: " + data.resultStoredHeader.getBlockheight());
        return data;
    }
    /**
     * Saves blockheaders as a bitcoin main chain to the btc relay
     *
     * @param signer
     * @param mainHeaders
     * @param storedHeader
     * @param feeRate
     */
    saveMainHeaders(signer, mainHeaders, storedHeader, feeRate) {
        logger.debug("saveMainHeaders(): submitting main blockheaders, count: " + mainHeaders.length);
        return this._saveHeaders(signer, mainHeaders, storedHeader, null, 0, feeRate);
    }
    /**
     * Creates a new long fork and submits the headers to it
     *
     * @param signer
     * @param forkHeaders
     * @param storedHeader
     * @param tipWork
     * @param feeRate
     */
    async saveNewForkHeaders(signer, forkHeaders, storedHeader, tipWork, feeRate) {
        let forkId = Math.floor(Math.random() * 0xFFFFFFFFFFFF);
        logger.debug("saveNewForkHeaders(): submitting new fork & blockheaders," +
            " count: " + forkHeaders.length + " forkId: 0x" + forkId.toString(16));
        return await this._saveHeaders(signer, forkHeaders, storedHeader, tipWork, forkId, feeRate);
    }
    /**
     * Continues submitting blockheaders to a given fork
     *
     * @param signer
     * @param forkHeaders
     * @param storedHeader
     * @param forkId
     * @param tipWork
     * @param feeRate
     */
    saveForkHeaders(signer, forkHeaders, storedHeader, forkId, tipWork, feeRate) {
        logger.debug("saveForkHeaders(): submitting blockheaders to existing fork," +
            " count: " + forkHeaders.length + " forkId: 0x" + forkId.toString(16));
        return this._saveHeaders(signer, forkHeaders, storedHeader, tipWork, forkId, feeRate);
    }
    /**
     * Submits short fork with given blockheaders
     *
     * @param signer
     * @param forkHeaders
     * @param storedHeader
     * @param tipWork
     * @param feeRate
     */
    saveShortForkHeaders(signer, forkHeaders, storedHeader, tipWork, feeRate) {
        logger.debug("saveShortForkHeaders(): submitting short fork blockheaders," +
            " count: " + forkHeaders.length);
        return this._saveHeaders(signer, forkHeaders, storedHeader, tipWork, -1, feeRate);
    }
    /**
     * Estimate required synchronization fee (worst case) to synchronize btc relay to the required blockheight
     *
     * @param requiredBlockheight
     * @param feeRate
     */
    async estimateSynchronizeFee(requiredBlockheight, feeRate) {
        const tipData = await this.getTipData();
        const currBlockheight = tipData.blockheight;
        const blockheightDelta = requiredBlockheight - currBlockheight;
        if (blockheightDelta <= 0)
            return 0n;
        const synchronizationFee = BigInt(blockheightDelta) * await this.getFeePerBlock(feeRate);
        logger.debug("estimateSynchronizeFee(): required blockheight: " + requiredBlockheight +
            " blockheight delta: " + blockheightDelta + " fee: " + synchronizationFee.toString(10));
        return synchronizationFee;
    }
    /**
     * Returns fee required (in SOL) to synchronize a single block to btc relay
     *
     * @param feeRate
     */
    async getFeePerBlock(feeRate) {
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        return StarknetFees_1.StarknetFees.getGasFee(GAS_PER_BLOCKHEADER, feeRate);
    }
    /**
     * Gets fee rate required for submitting blockheaders to the main chain
     */
    getMainFeeRate(signer) {
        return this.Chain.Fees.getFeeRate();
    }
    /**
     * Gets fee rate required for submitting blockheaders to the specific fork
     */
    getForkFeeRate(signer, forkId) {
        return this.Chain.Fees.getFeeRate();
    }
    saveInitialHeader(signer, header, epochStart, pastBlocksTimestamps, feeRate) {
        throw new Error("Not supported, starknet contract is initialized with constructor!");
    }
    /**
     * Gets committed header, identified by blockhash & blockheight, determines required BTC relay blockheight based on
     *  requiredConfirmations
     * If synchronizer is passed & blockhash is not found, it produces transactions to sync up the btc relay to the
     *  current chain tip & adds them to the txs array
     *
     * @param signer
     * @param btcRelay
     * @param btcTxs
     * @param txs solana transaction array, in case we need to synchronize the btc relay ourselves the synchronization
     *  txns are added here
     * @param synchronizer optional synchronizer to use to synchronize the btc relay in case it is not yet synchronized
     *  to the required blockheight
     * @param feeRate Fee rate to use for synchronization transactions
     * @private
     */
    static async getCommitedHeadersAndSynchronize(signer, btcRelay, btcTxs, txs, synchronizer, feeRate) {
        const leavesTxs = [];
        const blockheaders = {};
        for (let btcTx of btcTxs) {
            const requiredBlockheight = btcTx.blockheight + btcTx.requiredConfirmations - 1;
            const result = await (0, Utils_1.tryWithRetries)(() => btcRelay.retrieveLogAndBlockheight({
                blockhash: btcTx.blockhash
            }, requiredBlockheight));
            if (result != null) {
                blockheaders[result.header.getBlockHash().toString("hex")] = result.header;
            }
            else {
                leavesTxs.push(btcTx);
            }
        }
        if (leavesTxs.length === 0)
            return blockheaders;
        //Need to synchronize
        if (synchronizer == null)
            return null;
        //TODO: We don't have to synchronize to tip, only to our required blockheight
        const resp = await synchronizer.syncToLatestTxs(signer.toString(), feeRate);
        logger.debug("getCommitedHeaderAndSynchronize(): BTC Relay not synchronized to required blockheight, " +
            "synchronizing ourselves in " + resp.txs.length + " txs");
        logger.debug("getCommitedHeaderAndSynchronize(): BTC Relay computed header map: ", resp.computedHeaderMap);
        txs.push(...resp.txs);
        for (let key in resp.computedHeaderMap) {
            const header = resp.computedHeaderMap[key];
            blockheaders[header.getBlockHash().toString("hex")] = header;
        }
        //Check that blockhashes of all the rest txs are included
        for (let btcTx of leavesTxs) {
            if (blockheaders[btcTx.blockhash] == null)
                return null;
        }
        //Retrieve computed headers
        return blockheaders;
    }
}
exports.StarknetBtcRelay = StarknetBtcRelay;
