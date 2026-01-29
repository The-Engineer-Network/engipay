"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MempoolApi = void 0;
const buffer_1 = require("buffer");
const Utils_1 = require("../../utils/Utils");
const RequestError_1 = require("../../errors/RequestError");
class MempoolApi {
    /**
     * Returns api url that should be operational
     *
     * @private
     */
    getOperationalApi() {
        return this.backends.find(e => e.operational === true);
    }
    /**
     * Returns api urls that are maybe operational, in case none is considered operational returns all of the price
     *  apis such that they can be tested again whether they are operational
     *
     * @private
     */
    getMaybeOperationalApis() {
        let operational = this.backends.filter(e => e.operational === true || e.operational === null);
        if (operational.length === 0) {
            this.backends.forEach(e => e.operational = null);
            operational = this.backends;
        }
        return operational;
    }
    /**
     * Sends a GET or POST request to the mempool api, handling the non-200 responses as errors & throwing
     *
     * @param url
     * @param path
     * @param responseType
     * @param type
     * @param body
     */
    async _request(url, path, responseType, type = "GET", body) {
        const response = await (0, Utils_1.fetchWithTimeout)(url + path, {
            method: type,
            timeout: this.timeout,
            body: typeof (body) === "string" ? body : JSON.stringify(body)
        });
        if (response.status !== 200) {
            let resp;
            try {
                resp = await response.text();
            }
            catch (e) {
                throw new RequestError_1.RequestError(response.statusText, response.status);
            }
            throw RequestError_1.RequestError.parse(resp, response.status);
        }
        if (responseType === "str")
            return await response.text();
        return await response.json();
    }
    /**
     * Sends request in parallel to multiple maybe operational api urls
     *
     * @param path
     * @param responseType
     * @param type
     * @param body
     * @private
     */
    async requestFromMaybeOperationalUrls(path, responseType, type = "GET", body) {
        try {
            return await (0, Utils_1.promiseAny)(this.getMaybeOperationalApis().map(obj => (async () => {
                try {
                    const result = await this._request(obj.url, path, responseType, type, body);
                    obj.operational = true;
                    return result;
                }
                catch (e) {
                    //Only mark as non operational on 5xx server errors!
                    if (e instanceof RequestError_1.RequestError && Math.floor(e.httpCode / 100) !== 5) {
                        obj.operational = true;
                        throw e;
                    }
                    else {
                        obj.operational = false;
                        throw e;
                    }
                }
            })()));
        }
        catch (e) {
            throw e.find(err => err instanceof RequestError_1.RequestError && Math.floor(err.httpCode / 100) !== 5) || e[0];
        }
    }
    /**
     * Sends a request to mempool API, first tries to use the operational API (if any) and if that fails it falls back
     *  to using maybe operational price APIs
     *
     * @param path
     * @param responseType
     * @param type
     * @param body
     * @private
     */
    async request(path, responseType, type = "GET", body) {
        return (0, Utils_1.tryWithRetries)(() => {
            const operationalPriceApi = this.getOperationalApi();
            if (operationalPriceApi != null) {
                return this._request(operationalPriceApi.url, path, responseType, type, body).catch(err => {
                    //Only retry on 5xx server errors!
                    if (err instanceof RequestError_1.RequestError && Math.floor(err.httpCode / 100) !== 5)
                        throw err;
                    operationalPriceApi.operational = false;
                    return this.requestFromMaybeOperationalUrls(path, responseType, type, body);
                });
            }
            return this.requestFromMaybeOperationalUrls(path, responseType, type, body);
        }, null, (err) => err instanceof RequestError_1.RequestError && Math.floor(err.httpCode / 100) !== 5);
    }
    constructor(url, timeout) {
        url = url ?? "https://mempool.space/testnet/api/";
        if (Array.isArray(url)) {
            this.backends = url.map(val => {
                return { url: val, operational: null };
            });
        }
        else {
            this.backends = [
                { url: url, operational: null }
            ];
        }
        this.timeout = timeout;
    }
    /**
     * Returns information about a specific lightning network node as identified by the public key (in hex encoding)
     *
     * @param pubkey
     */
    getLNNodeInfo(pubkey) {
        return this.request("v1/lightning/nodes/" + pubkey, "obj").catch((e) => {
            if (e.message === "This node does not exist, or our node is not seeing it yet")
                return null;
            throw e;
        });
    }
    /**
     * Returns on-chain transaction as identified by its txId
     *
     * @param txId
     */
    getTransaction(txId) {
        return this.request("tx/" + txId, "obj").catch((e) => {
            if (e.message === "Transaction not found")
                return null;
            throw e;
        });
    }
    /**
     * Returns raw binary encoded bitcoin transaction, also strips the witness data from the transaction
     *
     * @param txId
     */
    async getRawTransaction(txId) {
        const rawTransaction = await this.request("tx/" + txId + "/hex", "str").catch((e) => {
            if (e.message === "Transaction not found")
                return null;
            throw e;
        });
        return rawTransaction == null ? null : buffer_1.Buffer.from(rawTransaction, "hex");
    }
    /**
     * Returns confirmed & unconfirmed balance of the specific bitcoin address
     *
     * @param address
     */
    async getAddressBalances(address) {
        const jsonBody = await this.request("address/" + address, "obj");
        const confirmedInput = BigInt(jsonBody.chain_stats.funded_txo_sum);
        const confirmedOutput = BigInt(jsonBody.chain_stats.spent_txo_sum);
        const unconfirmedInput = BigInt(jsonBody.mempool_stats.funded_txo_sum);
        const unconfirmedOutput = BigInt(jsonBody.mempool_stats.spent_txo_sum);
        return {
            confirmedBalance: confirmedInput - confirmedOutput,
            unconfirmedBalance: unconfirmedInput - unconfirmedOutput
        };
    }
    /**
     * Returns CPFP (children pays for parent) data for a given transaction
     *
     * @param txId
     */
    getCPFPData(txId) {
        return this.request("v1/cpfp/" + txId, "obj");
    }
    /**
     * Returns UTXOs (unspent transaction outputs) for a given address
     *
     * @param address
     */
    async getAddressUTXOs(address) {
        let jsonBody = await this.request("address/" + address + "/utxo", "obj");
        jsonBody.forEach(e => e.value = BigInt(e.value));
        return jsonBody;
    }
    /**
     * Returns current on-chain bitcoin fees
     */
    getFees() {
        return this.request("v1/fees/recommended", "obj");
    }
    /**
     * Returns all transactions for a given address
     *
     * @param address
     */
    getAddressTransactions(address) {
        return this.request("address/" + address + "/txs", "obj");
    }
    /**
     * Returns expected pending (mempool) blocks
     */
    getPendingBlocks() {
        return this.request("v1/fees/mempool-blocks", "obj");
    }
    /**
     * Returns the blockheight of the current bitcoin blockchain's tip
     */
    async getTipBlockHeight() {
        const response = await this.request("blocks/tip/height", "str");
        return parseInt(response);
    }
    /**
     * Returns the bitcoin blockheader as identified by its blockhash
     *
     * @param blockhash
     */
    getBlockHeader(blockhash) {
        return this.request("block/" + blockhash, "obj");
    }
    /**
     * Returns the block status
     *
     * @param blockhash
     */
    getBlockStatus(blockhash) {
        return this.request("block/" + blockhash + "/status", "obj");
    }
    /**
     * Returns the transaction's proof (merkle proof)
     *
     * @param txId
     */
    getTransactionProof(txId) {
        return this.request("tx/" + txId + "/merkle-proof", "obj");
    }
    /**
     * Returns the transaction's proof (merkle proof)
     *
     * @param txId
     */
    getOutspends(txId) {
        return this.request("tx/" + txId + "/outspends", "obj");
    }
    /**
     * Returns blockhash of a block at a specific blockheight
     *
     * @param height
     */
    getBlockHash(height) {
        return this.request("block-height/" + height, "str");
    }
    /**
     * Returns past 15 blockheaders before (and including) the specified height
     *
     * @param endHeight
     */
    getPast15BlockHeaders(endHeight) {
        return this.request("v1/blocks/" + endHeight, "obj");
    }
    /**
     * Sends raw hex encoded bitcoin transaction
     *
     * @param transactionHex
     */
    sendTransaction(transactionHex) {
        return this.request("tx", "str", "POST", transactionHex);
    }
}
exports.MempoolApi = MempoolApi;
