import {StarknetSigner} from "./StarknetSigner";
import {StarknetTransactions, StarknetTx} from "../chain/modules/StarknetTransactions";
import {StarknetChainInterface} from "../chain/StarknetChainInterface";
import {bigIntMax, getLogger, LoggerType} from "../../utils/Utils";
import {Account, BlockTag} from "starknet";
import {access, readFile, writeFile, mkdir, constants} from "fs/promises";
import {StarknetFees} from "../chain/modules/StarknetFees";
import {cloneDeep} from "@scure/btc-signer/transaction";
import { PromiseQueue } from "promise-queue-ts";

const WAIT_BEFORE_BUMP = 15*1000;
const MIN_FEE_INCREASE_ABSOLUTE = 1n*1_000_000n; //0.001GWei
const MIN_FEE_INCREASE_PPM = 110_000n; // +11%

const MIN_TIP_INCREASE_ABSOLUTE = 1n*1_000_000_000n; //1GWei
const MIN_TIP_INCREASE_PPM = 110_000n; // +11%

export type StarknetPersistentSignerConfig = {
    waitBeforeBump?: number;
    minFeeIncreaseAbsolute?: bigint;
    minFeeIncreasePpm?: bigint
    minTipIncreaseAbsolute?: bigint;
    minTipIncreasePpm?: bigint;
};

export class StarknetPersistentSigner extends StarknetSigner {

    private pendingTxs: Map<bigint, {
        txs: StarknetTx[],
        lastBumped: number,
        sending?: boolean //Not saved
    }> = new Map();

    private confirmedNonce: bigint;
    private pendingNonce: bigint;

    private feeBumper: any;
    private stopped: boolean = false;

    private readonly directory: string;

    private readonly config: StarknetPersistentSignerConfig

    private readonly chainInterface: StarknetChainInterface;

    private readonly logger: LoggerType;

    constructor(
        account: Account,
        chainInterface: StarknetChainInterface,
        directory: string,
        config?: StarknetPersistentSignerConfig,
    ) {
        super(account, true);
        this.signTransaction = null;
        this.chainInterface = chainInterface;
        this.directory = directory;
        this.config = config ?? {};
        this.config.minFeeIncreaseAbsolute ??= MIN_FEE_INCREASE_ABSOLUTE;
        this.config.minFeeIncreasePpm ??= MIN_FEE_INCREASE_PPM;
        this.config.minTipIncreaseAbsolute ??= MIN_TIP_INCREASE_ABSOLUTE;
        this.config.minTipIncreasePpm ??= MIN_TIP_INCREASE_PPM;
        this.config.waitBeforeBump ??= WAIT_BEFORE_BUMP;
        this.logger = getLogger("StarknetPersistentSigner("+this.account.address+"): ");
    }

    private async load() {
        const fileExists = await access(this.directory+"/txs.json", constants.F_OK).then(() => true).catch(() => false);
        if(!fileExists) return;
        const res = await readFile(this.directory+"/txs.json");
        if(res!=null) {
            const pendingTxs: {
                [nonce: string]: {
                    txs: string[],
                    lastBumped: number
                }
            } = JSON.parse((res as Buffer).toString());

            for(let nonceStr in pendingTxs) {
                const nonceData = pendingTxs[nonceStr];

                const nonce = BigInt(nonceStr);
                if(this.confirmedNonce>=nonce) continue; //Already confirmed

                if(this.pendingNonce<nonce) {
                    this.pendingNonce = nonce;
                }
                const parsedPendingTxns = nonceData.txs.map(StarknetTransactions.deserializeTx);
                this.pendingTxs.set(nonce, {
                    txs: parsedPendingTxns,
                    lastBumped: nonceData.lastBumped
                })
                for(let tx of parsedPendingTxns) {
                    this.chainInterface.Transactions._knownTxSet.add(tx.txId);
                }
            }
        }
    }

    private priorSavePromise: Promise<void>;
    private saveCount: number = 0;

    private async save() {
        const pendingTxs: {
            [nonce: string]: {
                txs: string[],
                lastBumped: number
            }
        } = {};
        for(let [nonce, data] of this.pendingTxs) {
            pendingTxs[nonce.toString(10)] = {
                lastBumped: data.lastBumped,
                txs: data.txs.map(StarknetTransactions.serializeTx)
            };
        }
        const requiredSaveCount = ++this.saveCount;
        if(this.priorSavePromise!=null) {
            await this.priorSavePromise;
        }
        if(requiredSaveCount===this.saveCount) {
            this.priorSavePromise = writeFile(this.directory+"/txs.json", JSON.stringify(pendingTxs));
            await this.priorSavePromise;
        }
    }

    private async checkPastTransactions() {
        let _gasPrice: {l1GasCost: bigint, l2GasCost: bigint, l1DataGasCost: bigint} = null;
        let _safeBlockNonce: bigint = null;

        for(let [nonce, data] of this.pendingTxs) {
            if(!data.sending && data.lastBumped<Date.now()-this.config.waitBeforeBump) {
                if(_safeBlockNonce==null) {
                    _safeBlockNonce = await this.chainInterface.Transactions.getNonce(this.account.address, BlockTag.LATEST);
                    this.confirmedNonce = _safeBlockNonce - 1n;
                }
                if(this.confirmedNonce >= nonce) {
                    this.pendingTxs.delete(nonce);
                    data.txs.forEach(tx => this.chainInterface.Transactions._knownTxSet.delete(tx.txId));
                    this.logger.info("checkPastTransactions(): Tx confirmed, required fee bumps: ", data.txs.length);
                    this.save();
                    continue;
                }

                const lastTx = data.txs[data.txs.length-1];
                if(_gasPrice==null) {
                    const feeRate = await this.chainInterface.Fees.getFeeRate();
                    _gasPrice = StarknetFees.extractFromFeeRateString(feeRate);
                }

                let l1GasCost = BigInt(lastTx.details.resourceBounds.l1_gas.max_price_per_unit);
                let l2GasCost = BigInt(lastTx.details.resourceBounds.l2_gas.max_price_per_unit);
                let l1DataGasCost = BigInt(lastTx.details.resourceBounds.l1_data_gas.max_price_per_unit);
                let tip = BigInt(lastTx.details.tip);

                let feeBumped: boolean = false;
                if(_gasPrice.l1GasCost > l1GasCost) {
                    //Bump by minimum allowed or to the actual _gasPrice.l1GasCost
                    l1GasCost = bigIntMax(_gasPrice.l1GasCost, this.config.minFeeIncreaseAbsolute + (l1GasCost * (1_000_000n + this.config.minFeeIncreasePpm) / 1_000_000n));
                    feeBumped = true;
                }
                if(_gasPrice.l1DataGasCost > l1DataGasCost) {
                    //Bump by minimum allowed or to the actual _gasPrice.l1GasCost
                    l1DataGasCost = bigIntMax(_gasPrice.l1DataGasCost, this.config.minFeeIncreaseAbsolute + (l1DataGasCost * (1_000_000n + this.config.minFeeIncreasePpm) / 1_000_000n));
                    feeBumped = true;
                }
                if(_gasPrice.l2GasCost > l2GasCost || feeBumped) { //In case the fees for l1 and l1Data were bumped, we also need to bump the l2GasFee regardless
                    l2GasCost = bigIntMax(_gasPrice.l2GasCost, this.config.minFeeIncreaseAbsolute + (l2GasCost * (1_000_000n + this.config.minFeeIncreasePpm) / 1_000_000n));
                    feeBumped = true;
                }
                if(feeBumped) tip = this.config.minTipIncreaseAbsolute + (tip * (1_000_000n + this.config.minTipIncreasePpm) / 1_000_000n);

                if(!feeBumped) {
                    //Not fee bumped
                    this.logger.debug("checkPastTransactions(): Tx yet unconfirmed but not increasing fee for ", lastTx.txId);
                    //Rebroadcast the tx
                    await this.chainInterface.Transactions.sendTransaction(lastTx).catch(e => {
                        if(e.baseError?.code === 52) { //Invalid transaction nonce
                            this.logger.debug("checkPastTransactions(): Tx re-broadcast success, tx already confirmed: ", lastTx.txId);
                            return;
                        }
                        if(e.baseError?.code === 59) { //Transaction already in the mempool
                            this.logger.debug("checkPastTransactions(): Tx re-broadcast success, tx already known to the RPC: ", lastTx.txId);
                            return;
                        }
                        this.logger.error("checkPastTransactions(): Tx re-broadcast error", e)
                    });
                    data.lastBumped = Date.now();
                    continue;
                }

                const newTx = cloneDeep(lastTx);
                delete newTx.signed;
                delete newTx.txId;

                newTx.details.tip = tip;
                newTx.details.resourceBounds.l1_gas.max_price_per_unit = l1GasCost;
                newTx.details.resourceBounds.l2_gas.max_price_per_unit = l2GasCost;
                newTx.details.resourceBounds.l1_data_gas.max_price_per_unit = l1DataGasCost;

                await this._signTransaction(newTx);
                this.logger.info(`checkPastTransactions(): Bump fee for tx ${lastTx.txId} -> ${newTx.txId}`);

                //Double check pending txns still has nonce after async signTransaction was called
                if(!this.pendingTxs.has(nonce)) continue;

                for(let callback of this.chainInterface.Transactions._cbksBeforeTxReplace) {
                    try {
                        await callback(StarknetTransactions.serializeTx(lastTx), lastTx.txId, StarknetTransactions.serializeTx(newTx), newTx.txId)
                    } catch (e) {
                        this.logger.error("checkPastTransactions(): beforeTxReplace callback error: ", e);
                    }
                }

                data.txs.push(newTx);
                data.lastBumped = Date.now();
                this.save();

                this.chainInterface.Transactions._knownTxSet.add(newTx.txId);

                //TODO: Better error handling when sending tx
                await this.chainInterface.Transactions.sendTransaction(newTx).catch(e => {
                    if(e.baseError?.code === 52) { //Invalid transaction nonce
                        return
                    }
                    this.logger.error("checkPastTransactions(): Fee-bumped tx broadcast error", e)
                });
            }
        }
    }

    private startFeeBumper() {
        let func: () => Promise<void>;
        func = async () => {
            try {
                await this.checkPastTransactions();
            } catch (e) {
                this.logger.error("startFeeBumper(): Error when check past transactions: ", e);
            }

            if(this.stopped) return;

            this.feeBumper = setTimeout(func, 1000);
        };
        func();
    }

    private async syncNonceFromChain() {
        const txCount = await this.chainInterface.Transactions.getNonce(this.account.address, BlockTag.LATEST);
        this.confirmedNonce = txCount-1n;
        if(this.pendingNonce < this.confirmedNonce) {
            this.logger.info(`syncNonceFromChain(): Re-synced latest nonce from chain, adjusting local pending nonce ${this.pendingNonce} -> ${this.confirmedNonce}`);
            this.pendingNonce = this.confirmedNonce;
            for(let [nonce, data] of this.pendingTxs) {
                if(nonce <= this.pendingNonce) {
                    this.pendingTxs.delete(nonce);
                    data.txs.forEach(tx => this.chainInterface.Transactions._knownTxSet.delete(tx.txId));
                    this.logger.info(`syncNonceFromChain(): Tx confirmed, nonce: ${nonce}, required fee bumps: `, data.txs.length);
                }
            }
            this.save();
        }
    }

    async init(): Promise<void> {
        try {
            await mkdir(this.directory)
        } catch (e) {}

        const nonce = await this.chainInterface.Transactions.getNonce(this.account.address, BlockTag.LATEST);
        this.confirmedNonce = nonce - 1n;
        this.pendingNonce = nonce - 1n;

        await this.load();

        this.startFeeBumper();
    }

    stop(): Promise<void> {
        this.stopped = true;
        if(this.feeBumper!=null) {
            clearTimeout(this.feeBumper);
            this.feeBumper = null;
        }
        return Promise.resolve();
    }

    private readonly sendTransactionQueue: PromiseQueue = new PromiseQueue();

    sendTransaction(transaction: StarknetTx, onBeforePublish?: (txId: string, rawTx: string) => Promise<void>): Promise<string> {
        return this.sendTransactionQueue.enqueue(async () => {
            if(transaction.details.nonce!=null) {
                if(transaction.details.nonce !== this.pendingNonce + 1n)
                    throw new Error("Invalid transaction nonce!");
            } else {
                transaction.details.nonce = this.pendingNonce + 1n;
            }

            const signedTx = await this._signTransaction(transaction);

            if(onBeforePublish!=null) {
                try {
                    await onBeforePublish(signedTx.txId, StarknetTransactions.serializeTx(signedTx));
                } catch (e) {
                    this.logger.error("sendTransaction(): Error when calling onBeforePublish function: ", e);
                }
            }

            const pendingTxObject = {txs: [signedTx], lastBumped: Date.now(), sending: true};
            this.pendingNonce++;
            this.logger.debug("sendTransaction(): Incrementing pending nonce to: ", this.pendingNonce);
            this.pendingTxs.set(transaction.details.nonce, pendingTxObject);
            this.save();

            this.chainInterface.Transactions._knownTxSet.add(signedTx.txId);

            try {
                const result = await this.chainInterface.Transactions.sendTransaction(signedTx);
                pendingTxObject.sending = false;
                return result;
            } catch (e) {
                this.chainInterface.Transactions._knownTxSet.delete(signedTx.txId);
                this.pendingTxs.delete(transaction.details.nonce);
                this.pendingNonce--;
                this.logger.debug("sendTransaction(): Error when broadcasting transaction, reverting pending nonce to: ", this.pendingNonce);
                if(e.baseError?.code === 52) { //Invalid transaction nonce
                    //Re-check nonce from on-chain
                    this.logger.info("sendTransaction(): Got INVALID_TRANSACTION_NONCE (52) back from backend, re-checking latest nonce from chain!");
                    await this.syncNonceFromChain();
                }
                throw e;
            }
        });
    }

}