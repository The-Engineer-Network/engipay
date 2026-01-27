import {AmountData, ISwapWrapper, ISwapWrapperOptions, WrapperCtorTokens} from "../ISwapWrapper";
import {
    BtcRelay,
    ChainEvent,
    ChainType,
    RelaySynchronizer,
    SpvVaultClaimEvent,
    SpvVaultCloseEvent,
    SpvVaultFrontEvent, SpvVaultTokenBalance, SpvWithdrawalStateType
} from "@atomiqlabs/base";
import {SpvFromBTCSwap, SpvFromBTCSwapInit, SpvFromBTCSwapState} from "./SpvFromBTCSwap";
import {BTC_NETWORK, TEST_NETWORK} from "@scure/btc-signer/utils";
import {SwapType} from "../enums/SwapType";
import {BitcoinRpcWithAddressIndex} from "../../btc/BitcoinRpcWithAddressIndex";
import {UnifiedSwapStorage} from "../../storage/UnifiedSwapStorage";
import {UnifiedSwapEventListener} from "../../events/UnifiedSwapEventListener";
import {ISwapPrice} from "../../prices/abstract/ISwapPrice";
import {EventEmitter} from "events";
import {Intermediary} from "../../intermediaries/Intermediary";
import {
    extendAbortController,
    randomBytes,
    tryWithRetries
} from "../../utils/Utils";
import {
    toCoinselectAddressType,
    toOutputScript
} from "../../utils/BitcoinUtils";
import {
    IntermediaryAPI,
    SpvFromBTCPrepareResponseType
} from "../../intermediaries/IntermediaryAPI";
import {RequestError} from "../../errors/RequestError";
import {IntermediaryError} from "../../errors/IntermediaryError";
import {CoinselectAddressTypes} from "../../btc/coinselect2";
import {OutScript, Transaction} from "@scure/btc-signer";
import {ISwap} from "../ISwap";
import {IClaimableSwapWrapper} from "../IClaimableSwapWrapper";

export type SpvFromBTCOptions = {
    gasAmount?: bigint,
    unsafeZeroWatchtowerFee?: boolean,
    feeSafetyFactor?: number,
    maxAllowedNetworkFeeRate?: number
};

export type SpvFromBTCWrapperOptions = ISwapWrapperOptions & {
    maxConfirmations?: number,
    bitcoinNetwork?: BTC_NETWORK,
    bitcoinBlocktime?: number,
    maxTransactionsDelta?: number, //Maximum accepted difference in state between SC state and bitcoin state, in terms of by how many transactions are they differing
    maxRawAmountAdjustmentDifferencePPM?: number,
    maxBtcFeeMultiplier?: number,
    maxBtcFeeOffset?: number
};

export class SpvFromBTCWrapper<
    T extends ChainType
> extends ISwapWrapper<T, SpvFromBTCSwap<T>, SpvFromBTCWrapperOptions> implements IClaimableSwapWrapper<SpvFromBTCSwap<T>> {

    public readonly claimableSwapStates = [SpvFromBTCSwapState.BTC_TX_CONFIRMED];
    public readonly TYPE = SwapType.SPV_VAULT_FROM_BTC;
    public readonly swapDeserializer = SpvFromBTCSwap;

    readonly synchronizer: RelaySynchronizer<any, T["TX"], any>;
    readonly contract: T["SpvVaultContract"];
    readonly btcRelay: T["BtcRelay"];
    readonly btcRpc: BitcoinRpcWithAddressIndex<any>;

    readonly spvWithdrawalDataDeserializer: new (data: any) => T["SpvVaultWithdrawalData"];

    /**
     * @param chainIdentifier
     * @param unifiedStorage Storage interface for the current environment
     * @param unifiedChainEvents On-chain event listener
     * @param chain
     * @param contract Underlying contract handling the swaps
     * @param prices Pricing to use
     * @param tokens
     * @param spvWithdrawalDataDeserializer Deserializer for SpvVaultWithdrawalData
     * @param btcRelay
     * @param synchronizer Btc relay synchronizer
     * @param btcRpc Bitcoin RPC which also supports getting transactions by txoHash
     * @param options
     * @param events Instance to use for emitting events
     */
    constructor(
        chainIdentifier: string,
        unifiedStorage: UnifiedSwapStorage<T>,
        unifiedChainEvents: UnifiedSwapEventListener<T>,
        chain: T["ChainInterface"],
        contract: T["SpvVaultContract"],
        prices: ISwapPrice,
        tokens: WrapperCtorTokens,
        spvWithdrawalDataDeserializer: new (data: any) => T["SpvVaultWithdrawalData"],
        btcRelay: BtcRelay<any, T["TX"], any>,
        synchronizer: RelaySynchronizer<any, T["TX"], any>,
        btcRpc: BitcoinRpcWithAddressIndex<any>,
        options?: SpvFromBTCWrapperOptions,
        events?: EventEmitter<{swapState: [ISwap]}>
    ) {
        if(options==null) options = {};
        options.bitcoinNetwork ??= TEST_NETWORK;
        options.maxConfirmations ??= 6;
        options.bitcoinBlocktime ??= 10*60;
        options.maxTransactionsDelta ??= 3;
        options.maxRawAmountAdjustmentDifferencePPM ??= 100;
        options.maxBtcFeeOffset ??= 5;
        options.maxBtcFeeMultiplier ??= 1.5;
        super(chainIdentifier, unifiedStorage, unifiedChainEvents, chain, prices, tokens, options, events);
        this.spvWithdrawalDataDeserializer = spvWithdrawalDataDeserializer;
        this.contract = contract;
        this.btcRelay = btcRelay;
        this.synchronizer = synchronizer;
        this.btcRpc = btcRpc;
    }

    readonly pendingSwapStates: Array<SpvFromBTCSwap<T>["state"]> = [
        SpvFromBTCSwapState.CREATED,
        SpvFromBTCSwapState.SIGNED,
        SpvFromBTCSwapState.POSTED,
        SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED,
        SpvFromBTCSwapState.BROADCASTED,
        SpvFromBTCSwapState.DECLINED,
        SpvFromBTCSwapState.BTC_TX_CONFIRMED
    ];
    readonly tickSwapState: Array<SpvFromBTCSwap<T>["state"]> = [
        SpvFromBTCSwapState.CREATED,
        SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED,
        SpvFromBTCSwapState.SIGNED,
        SpvFromBTCSwapState.POSTED,
        SpvFromBTCSwapState.BROADCASTED
    ];

    protected processEventFront(event: SpvVaultFrontEvent, swap: SpvFromBTCSwap<T>): boolean {
        if(
            swap.state===SpvFromBTCSwapState.SIGNED || swap.state===SpvFromBTCSwapState.POSTED ||
            swap.state===SpvFromBTCSwapState.BROADCASTED || swap.state===SpvFromBTCSwapState.DECLINED ||
            swap.state===SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED || swap.state===SpvFromBTCSwapState.BTC_TX_CONFIRMED
        ) {
            swap.state = SpvFromBTCSwapState.FRONTED;
            return true;
        }
        return false;
    }

    protected processEventClaim(event: SpvVaultClaimEvent, swap: SpvFromBTCSwap<T>): boolean {
        if(
            swap.state===SpvFromBTCSwapState.SIGNED || swap.state===SpvFromBTCSwapState.POSTED ||
            swap.state===SpvFromBTCSwapState.BROADCASTED || swap.state===SpvFromBTCSwapState.DECLINED ||
            swap.state===SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED || swap.state===SpvFromBTCSwapState.BTC_TX_CONFIRMED
        ) {
            swap.state = SpvFromBTCSwapState.CLAIMED;
            return true;
        }
        return false;
    }

    protected processEventClose(event: SpvVaultCloseEvent, swap: SpvFromBTCSwap<T>): boolean {
        if(
            swap.state===SpvFromBTCSwapState.SIGNED || swap.state===SpvFromBTCSwapState.POSTED ||
            swap.state===SpvFromBTCSwapState.BROADCASTED || swap.state===SpvFromBTCSwapState.DECLINED ||
            swap.state===SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED || swap.state===SpvFromBTCSwapState.BTC_TX_CONFIRMED
        ) {
            swap.state = SpvFromBTCSwapState.CLOSED;
            return true;
        }
        return false;
    }

    protected async processEvent(event: ChainEvent<T["Data"]>, swap: SpvFromBTCSwap<T>): Promise<boolean> {
        if(swap==null) return;

        let swapChanged: boolean = false;
        if(event instanceof SpvVaultFrontEvent) {
            swapChanged = this.processEventFront(event, swap);
            if(event.meta?.txId!=null && swap.frontTxId!==event.meta.txId) {
                swap.frontTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        if(event instanceof SpvVaultClaimEvent) {
            swapChanged = this.processEventClaim(event, swap);
            if(event.meta?.txId!=null && swap.claimTxId!==event.meta.txId) {
                swap.claimTxId = event.meta.txId;
                swapChanged ||= true;
            }
        }
        if(event instanceof SpvVaultCloseEvent) {
            swapChanged = this.processEventClose(event, swap);
        }

        this.logger.info("processEvents(): "+event.constructor.name+" processed for "+swap.getId()+" swap: ", swap);

        if(swapChanged) {
            await swap._saveAndEmit();
        }
        return true;
    }

    /**
     * Pre-fetches latest finalized block height of the smart chain
     *
     * @param abortController
     * @private
     */
    private async preFetchFinalizedBlockHeight(abortController: AbortController): Promise<number> {
        try {
            const block = await tryWithRetries(() => this.chain.getFinalizedBlock(), null, null, abortController.signal);
            return block.height;
        } catch (e) {
            abortController.abort(e);
            return null;
        }
    }

    /**
     * Pre-fetches caller (watchtower) bounty data for the swap. Doesn't throw, instead returns null and aborts the
     *  provided abortController
     *
     * @param amountData
     * @param options Options as passed to the swap creation function
     * @param pricePrefetch
     * @param nativeTokenPricePrefetch
     * @param abortController
     * @private
     */
    private async preFetchCallerFeeShare(
        amountData: AmountData,
        options: SpvFromBTCOptions,
        pricePrefetch: Promise<bigint>,
        nativeTokenPricePrefetch: Promise<bigint>,
        abortController: AbortController
    ): Promise<bigint> {
        if(options.unsafeZeroWatchtowerFee) return 0n;
        if(amountData.amount===0n) return 0n;

        try {
            const [
                feePerBlock,
                btcRelayData,
                currentBtcBlock,
                claimFeeRate,
                nativeTokenPrice
            ] = await Promise.all([
                tryWithRetries(() => this.btcRelay.getFeePerBlock(), null, null, abortController.signal),
                tryWithRetries(() => this.btcRelay.getTipData(), null, null, abortController.signal),
                this.btcRpc.getTipHeight(),
                tryWithRetries<bigint>(() => this.contract.getClaimFee(this.chain.randomAddress(), null, null), null, null, abortController.signal),
                nativeTokenPricePrefetch ?? (amountData.token===this.chain.getNativeCurrencyAddress() ?
                    pricePrefetch :
                    this.prices.preFetchPrice(this.chainIdentifier, this.chain.getNativeCurrencyAddress(), abortController.signal))
            ]);

            const currentBtcRelayBlock = btcRelayData.blockheight;
            const blockDelta = Math.max(currentBtcBlock-currentBtcRelayBlock+this.options.maxConfirmations, 0);

            const totalFeeInNativeToken = (
                (BigInt(blockDelta) * feePerBlock) +
                (claimFeeRate * BigInt(this.options.maxTransactionsDelta))
            ) * BigInt(Math.floor(options.feeSafetyFactor*1000000)) / 1_000_000n;

            let payoutAmount: bigint;
            if(amountData.exactIn) {
                //Convert input amount in BTC to
                const amountInNativeToken = await this.prices.getFromBtcSwapAmount(this.chainIdentifier, amountData.amount, this.chain.getNativeCurrencyAddress(), abortController.signal, nativeTokenPrice);
                payoutAmount = amountInNativeToken - totalFeeInNativeToken;
            } else {
                if(amountData.token===this.chain.getNativeCurrencyAddress()) {
                    //Both amounts in same currency
                    payoutAmount = amountData.amount;
                } else {
                    //Need to convert both to native currency
                    const btcAmount = await this.prices.getToBtcSwapAmount(this.chainIdentifier, amountData.amount, amountData.token, abortController.signal, await pricePrefetch);
                    payoutAmount = await this.prices.getFromBtcSwapAmount(this.chainIdentifier, btcAmount, this.chain.getNativeCurrencyAddress(), abortController.signal, nativeTokenPrice);
                }
            }

            this.logger.debug("preFetchCallerFeeShare(): Caller fee in native token: "+totalFeeInNativeToken.toString(10)+" total payout in native token: "+payoutAmount.toString(10));

            const callerFeeShare = ((totalFeeInNativeToken * 100_000n) + payoutAmount - 1n) / payoutAmount; //Make sure to round up here
            if(callerFeeShare < 0n) return 0n;
            if(callerFeeShare >= 2n**20n) return 2n**20n - 1n;
            return callerFeeShare;
        } catch (e) {
            abortController.abort(e);
            return null;
        }
    }


    /**
     * Verifies response returned from intermediary
     *
     * @param resp Response as returned by the intermediary
     * @param amountData
     * @param lp Intermediary
     * @param options Options as passed to the swap creation function
     * @param callerFeeShare
     * @param bitcoinFeeRatePromise Maximum accepted fee rate from the LPs
     * @param abortSignal
     * @private
     * @throws {IntermediaryError} in case the response is invalid
     */
    private async verifyReturnedData(
        resp: SpvFromBTCPrepareResponseType,
        amountData: AmountData,
        lp: Intermediary,
        options: SpvFromBTCOptions,
        callerFeeShare: bigint,
        bitcoinFeeRatePromise: Promise<number>,
        abortSignal: AbortSignal
    ): Promise<{
        vault: T["SpvVaultData"],
        vaultUtxoValue: number
    }> {
        const btcFeeRate = await bitcoinFeeRatePromise;
        abortSignal.throwIfAborted();
        if(btcFeeRate!=null && resp.btcFeeRate > btcFeeRate) throw new IntermediaryError("Bitcoin fee rate returned too high!");

        //Vault related
        let vaultScript: Uint8Array;
        let vaultAddressType: CoinselectAddressTypes;
        let btcAddressScript: Uint8Array;
        //Ensure valid btc addresses returned
        try {
            vaultScript = toOutputScript(this.options.bitcoinNetwork, resp.vaultBtcAddress);
            vaultAddressType = toCoinselectAddressType(vaultScript);
            btcAddressScript = toOutputScript(this.options.bitcoinNetwork, resp.btcAddress);
        } catch (e) {
            throw new IntermediaryError("Invalid btc address data returned", e);
        }
        const decodedUtxo = resp.btcUtxo.split(":");
        if(
            resp.address!==lp.getAddress(this.chainIdentifier) || //Ensure the LP is indeed the vault owner
            resp.vaultId < 0n || //Ensure vaultId is not negative
            vaultScript==null || //Make sure vault script is parsable and of known type
            btcAddressScript==null || //Make sure btc address script is parsable and of known type
            vaultAddressType==="p2pkh" || vaultAddressType==="p2sh-p2wpkh" || //Constrain the vault script type to witness types
            decodedUtxo.length!==2 || decodedUtxo[0].length!==64 || isNaN(parseInt(decodedUtxo[1])) || //Check valid UTXO
            resp.btcFeeRate < 1 || resp.btcFeeRate > 10000 //Sanity check on the returned BTC fee rate
        ) throw new IntermediaryError("Invalid vault data returned!");

        //Amounts sanity
        if(resp.btcAmountSwap + resp.btcAmountGas !==resp.btcAmount) throw new Error("Btc amount mismatch");
        if(resp.swapFeeBtc + resp.gasSwapFeeBtc !==resp.totalFeeBtc) throw new Error("Btc fee mismatch");

        //TODO: For now ensure fees are at 0
        if(
            resp.callerFeeShare!==callerFeeShare ||
            resp.frontingFeeShare!==0n ||
            resp.executionFeeShare!==0n
        ) throw new IntermediaryError("Invalid caller/fronting/execution fee returned");

        //Check expiry
        const timeNowSeconds = Math.floor(Date.now()/1000);
        if(resp.expiry < timeNowSeconds) throw new IntermediaryError(`Quote already expired, expiry: ${resp.expiry}, systemTime: ${timeNowSeconds}, clockAdjusted: ${(Date as any)._now!=null}`);

        let utxo = resp.btcUtxo.toLowerCase();
        const [txId, voutStr] = utxo.split(":");

        const abortController = extendAbortController(abortSignal);
        let [vault, {vaultUtxoValue, btcTx}] = await Promise.all([
            (async() => {
                //Fetch vault data
                let vault: T["SpvVaultData"];
                try {
                    vault = await this.contract.getVaultData(resp.address, resp.vaultId);
                } catch (e) {
                    this.logger.error("Error getting spv vault (owner: "+resp.address+" vaultId: "+resp.vaultId.toString(10)+"): ", e);
                    throw new IntermediaryError("Spv swap vault not found", e);
                }
                abortController.signal.throwIfAborted();

                //Make sure vault is opened
                if(!vault.isOpened()) throw new IntermediaryError("Returned spv swap vault is not opened!");
                //Make sure the vault doesn't require insane amount of confirmations
                if(vault.getConfirmations()>this.options.maxConfirmations) throw new IntermediaryError("SPV swap vault needs too many confirmations: "+vault.getConfirmations());
                const tokenData = vault.getTokenData();

                //Amounts - make sure the amounts match
                if(amountData.exactIn) {
                    if(resp.btcAmount !== amountData.amount) throw new IntermediaryError("Invalid amount returned");
                } else {
                    //Check the difference between amount adjusted due to scaling to raw amount
                    const adjustedAmount = amountData.amount / tokenData[0].multiplier * tokenData[0].multiplier;
                    const adjustmentPPM = (amountData.amount - adjustedAmount)*1_000_000n / amountData.amount;
                    if(adjustmentPPM > this.options.maxRawAmountAdjustmentDifferencePPM)
                        throw new IntermediaryError("Invalid amount0 multiplier used, rawAmount diff too high");
                    if(resp.total !== adjustedAmount) throw new IntermediaryError("Invalid total returned");
                }
                if(options.gasAmount==null || options.gasAmount===0n) {
                    if(resp.totalGas !== 0n) throw new IntermediaryError("Invalid gas total returned");
                } else {
                    //Check the difference between amount adjusted due to scaling to raw amount
                    const adjustedGasAmount = options.gasAmount / tokenData[0].multiplier * tokenData[0].multiplier;
                    const adjustmentPPM = (options.gasAmount - adjustedGasAmount)*1_000_000n / options.gasAmount;
                    if(adjustmentPPM > this.options.maxRawAmountAdjustmentDifferencePPM)
                        throw new IntermediaryError("Invalid amount1 multiplier used, rawAmount diff too high");
                    if(resp.totalGas !== adjustedGasAmount) throw new IntermediaryError("Invalid gas total returned");
                }

                return vault;
            })(),
            (async() => {
                //Require the vault UTXO to have at least 1 confirmation
                let btcTx = await this.btcRpc.getTransaction(txId);
                abortController.signal.throwIfAborted();
                if(btcTx.confirmations==null || btcTx.confirmations<1) throw new IntermediaryError("SPV vault UTXO not confirmed");
                const vout = parseInt(voutStr);
                if(btcTx.outs[vout]==null) throw new IntermediaryError("Invalid UTXO, doesn't exist");
                const vaultUtxoValue = btcTx.outs[vout].value;
                return {btcTx, vaultUtxoValue};
            })(),
            (async() => {
                //Require vault UTXO is unspent
                if(await this.btcRpc.isSpent(utxo)) throw new IntermediaryError("Returned spv vault UTXO is already spent", null, true);
                abortController.signal.throwIfAborted();
            })()
        ]).catch(e => {
            abortController.abort(e);
            throw e;
        });

        this.logger.debug("verifyReturnedData(): Vault UTXO: "+vault.getUtxo()+" current utxo: "+utxo);

        //Trace returned utxo back to what's saved on-chain
        let pendingWithdrawals: T["SpvVaultWithdrawalData"][] = [];
        while(vault.getUtxo()!==utxo) {
            const [txId, voutStr] = utxo.split(":");
            //Such that 1st tx isn't fetched twice
            if(btcTx.txid!==txId) btcTx = await this.btcRpc.getTransaction(txId);
            const withdrawalData = await this.contract.getWithdrawalData(btcTx);
            abortSignal.throwIfAborted();
            pendingWithdrawals.unshift(withdrawalData);
            utxo = pendingWithdrawals[0].getSpentVaultUtxo();
            this.logger.debug("verifyReturnedData(): Vault UTXO: "+vault.getUtxo()+" current utxo: "+utxo);
            if(pendingWithdrawals.length>=this.options.maxTransactionsDelta)
                throw new IntermediaryError("BTC <> SC state difference too deep, maximum: "+this.options.maxTransactionsDelta);
        }

        //Verify that the vault has enough balance after processing all pending withdrawals
        let vaultBalances: {balances: SpvVaultTokenBalance[]};
        try {
            vaultBalances = vault.calculateStateAfter(pendingWithdrawals);
        } catch (e) {
            this.logger.error("Error calculating spv vault balance (owner: "+resp.address+" vaultId: "+resp.vaultId.toString(10)+"): ", e);
            throw new IntermediaryError("Spv swap vault balance prediction failed", e);
        }
        if(vaultBalances.balances[0].scaledAmount < resp.total)
            throw new IntermediaryError("SPV swap vault, insufficient balance, required: "+resp.total.toString(10)+
                " has: "+vaultBalances.balances[0].scaledAmount.toString(10));
        if(vaultBalances.balances[1].scaledAmount < resp.totalGas)
            throw new IntermediaryError("SPV swap vault, insufficient balance, required: "+resp.totalGas.toString(10)+
                " has: "+vaultBalances.balances[1].scaledAmount.toString(10));

        //Also verify that all the withdrawal txns are valid, this is an extra sanity check
        try {
            for(let withdrawal of pendingWithdrawals) {
                await this.contract.checkWithdrawalTx(withdrawal);
            }
        } catch (e) {
            this.logger.error("Error calculating spv vault balance (owner: "+resp.address+" vaultId: "+resp.vaultId.toString(10)+"): ", e);
            throw new IntermediaryError("Spv swap vault balance prediction failed", e);
        }
        abortSignal.throwIfAborted();

        return {
            vault,
            vaultUtxoValue
        };
    }

    /**
     * Returns a newly created swap, receiving 'amount' on chain
     *
     * @param signer                Smartchain signer's address intiating the swap
     * @param amountData            Amount of token & amount to swap
     * @param lps                   LPs (liquidity providers) to get the quotes from
     * @param options               Quote options
     * @param additionalParams      Additional parameters sent to the LP when creating the swap
     * @param abortSignal           Abort signal for aborting the process
     */
    create(
        signer: string,
        amountData: AmountData,
        lps: Intermediary[],
        options?: SpvFromBTCOptions,
        additionalParams?: Record<string, any>,
        abortSignal?: AbortSignal
    ): {
        quote: Promise<SpvFromBTCSwap<T>>,
        intermediary: Intermediary
    }[] {
        options ??= {};
        options.gasAmount ??= 0n;
        options.feeSafetyFactor ??= 1.25;

        const _abortController = extendAbortController(abortSignal);
        const pricePrefetchPromise: Promise<bigint> = this.preFetchPrice(amountData, _abortController.signal);
        const finalizedBlockHeightPrefetchPromise: Promise<number> = this.preFetchFinalizedBlockHeight(_abortController);
        const nativeTokenAddress = this.chain.getNativeCurrencyAddress();
        const gasTokenPricePrefetchPromise: Promise<bigint> = options.gasAmount===0n ?
            null :
            this.preFetchPrice({token: nativeTokenAddress}, _abortController.signal);
        const callerFeePrefetchPromise = this.preFetchCallerFeeShare(amountData, options, pricePrefetchPromise, gasTokenPricePrefetchPromise, _abortController);
        const bitcoinFeeRatePromise: Promise<number> = options.maxAllowedNetworkFeeRate!=null ?
            Promise.resolve(options.maxAllowedNetworkFeeRate) :
            this.btcRpc.getFeeRate().then(x => this.options.maxBtcFeeOffset + (x*this.options.maxBtcFeeMultiplier)).catch(e => {
                _abortController.abort(e);
                return null;
            });

        return lps.map(lp => {
            return {
                intermediary: lp,
                quote: tryWithRetries(async () => {
                    const abortController = extendAbortController(_abortController.signal);

                    try {
                        const resp = await tryWithRetries(async(retryCount: number) => {
                            return await IntermediaryAPI.prepareSpvFromBTC(
                                this.chainIdentifier, lp.url,
                                {
                                    address: signer,
                                    amount: amountData.amount,
                                    token: amountData.token.toString(),
                                    exactOut: !amountData.exactIn,
                                    gasToken: nativeTokenAddress,
                                    gasAmount: options.gasAmount,
                                    callerFeeRate: callerFeePrefetchPromise,
                                    frontingFeeRate: 0n,
                                    additionalParams
                                },
                                this.options.postRequestTimeout, abortController.signal, retryCount>0 ? false : null
                            );
                        }, null, e => e instanceof RequestError, abortController.signal);

                        this.logger.debug("create("+lp.url+"): LP response: ", resp)

                        const callerFeeShare = await callerFeePrefetchPromise;

                        const [
                            pricingInfo,
                            gasPricingInfo,
                            {vault, vaultUtxoValue}
                        ] = await Promise.all([
                            this.verifyReturnedPrice(
                                lp.services[SwapType.SPV_VAULT_FROM_BTC],
                                false, resp.btcAmountSwap,
                                resp.total * (100_000n + callerFeeShare) / 100_000n,
                                amountData.token, {}, pricePrefetchPromise, abortController.signal
                            ),
                            options.gasAmount===0n ? Promise.resolve() : this.verifyReturnedPrice(
                                {...lp.services[SwapType.SPV_VAULT_FROM_BTC], swapBaseFee: 0}, //Base fee should be charged only on the amount, not on gas
                                false, resp.btcAmountGas,
                                resp.totalGas * (100_000n + callerFeeShare) / 100_000n,
                                nativeTokenAddress, {}, gasTokenPricePrefetchPromise, abortController.signal
                            ),
                            this.verifyReturnedData(resp, amountData, lp, options, callerFeeShare, bitcoinFeeRatePromise, abortController.signal)
                        ]);

                        const swapInit: SpvFromBTCSwapInit = {
                            pricingInfo,
                            url: lp.url,
                            expiry: resp.expiry * 1000,
                            swapFee: resp.swapFee,
                            swapFeeBtc: resp.swapFeeBtc,
                            exactIn: amountData.exactIn ?? true,

                            quoteId: resp.quoteId,

                            recipient: signer,

                            vaultOwner: resp.address,
                            vaultId: resp.vaultId,
                            vaultRequiredConfirmations: vault.getConfirmations(),
                            vaultTokenMultipliers: vault.getTokenData().map(val => val.multiplier),
                            vaultBtcAddress: resp.vaultBtcAddress,
                            vaultUtxo: resp.btcUtxo,
                            vaultUtxoValue: BigInt(vaultUtxoValue),

                            btcDestinationAddress: resp.btcAddress,
                            btcAmount: resp.btcAmount,
                            btcAmountSwap: resp.btcAmountSwap,
                            btcAmountGas: resp.btcAmountGas,
                            minimumBtcFeeRate: resp.btcFeeRate,

                            outputTotalSwap: resp.total,
                            outputSwapToken: amountData.token,
                            outputTotalGas: resp.totalGas,
                            outputGasToken: nativeTokenAddress,
                            gasSwapFeeBtc: resp.gasSwapFeeBtc,
                            gasSwapFee: resp.gasSwapFee,

                            callerFeeShare: resp.callerFeeShare,
                            frontingFeeShare: resp.frontingFeeShare,
                            executionFeeShare: resp.executionFeeShare,

                            genesisSmartChainBlockHeight: await finalizedBlockHeightPrefetchPromise
                        };
                        const quote = new SpvFromBTCSwap<T>(this, swapInit);
                        await quote._save();
                        return quote;
                    } catch (e) {
                        abortController.abort(e);
                        throw e;
                    }
                }, null, err => !(err instanceof IntermediaryError && err.recoverable), _abortController.signal)
            }
        });
    }

    /**
     * Returns a random dummy PSBT that can be used for fee estimation, the last output (the LP output) is omitted
     *  to allow for coinselection algorithm to determine maximum sendable amount there
     *
     * @param includeGasToken   Whether to return the PSBT also with the gas token amount (increases the vSize by 8)
     */
    public getDummySwapPsbt(includeGasToken = false): Transaction {
        //Construct dummy swap psbt
        const psbt = new Transaction({
            allowUnknownInputs: true,
            allowLegacyWitnessUtxo: true,
            allowUnknownOutputs: true
        });

        const randomVaultOutScript = OutScript.encode({type: "tr", pubkey: Buffer.from("0101010101010101010101010101010101010101010101010101010101010101", "hex")});

        psbt.addInput({
            txid: randomBytes(32),
            index: 0,
            witnessUtxo: {
                script: randomVaultOutScript,
                amount: 600n
            }
        });

        psbt.addOutput({
            script: randomVaultOutScript,
            amount: 600n
        });

        const opReturnData = this.contract.toOpReturnData(
            this.chain.randomAddress(),
            includeGasToken ? [0xFFFFFFFFFFFFFFFFn, 0xFFFFFFFFFFFFFFFFn] : [0xFFFFFFFFFFFFFFFFn]
        );

        psbt.addOutput({
            script: Buffer.concat([
                opReturnData.length <= 75 ? Buffer.from([0x6a, opReturnData.length]) : Buffer.from([0x6a, 0x4c, opReturnData.length]),
                opReturnData
            ]),
            amount: 0n
        });

        return psbt;
    }

    protected async _checkPastSwaps(pastSwaps: SpvFromBTCSwap<T>[]): Promise<{
        changedSwaps: SpvFromBTCSwap<T>[];
        removeSwaps: SpvFromBTCSwap<T>[]
    }> {
        const changedSwaps: Set<SpvFromBTCSwap<T>> = new Set();
        const removeSwaps: SpvFromBTCSwap<T>[] = [];

        const broadcastedOrConfirmedSwaps: SpvFromBTCSwap<T>[] = [];

        for(let pastSwap of pastSwaps) {
            let changed: boolean = false;

            if(
                pastSwap.state===SpvFromBTCSwapState.SIGNED ||
                pastSwap.state===SpvFromBTCSwapState.POSTED ||
                pastSwap.state===SpvFromBTCSwapState.BROADCASTED ||
                pastSwap.state===SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED ||
                pastSwap.state===SpvFromBTCSwapState.DECLINED ||
                pastSwap.state===SpvFromBTCSwapState.BTC_TX_CONFIRMED
            ) {
                //Check BTC transaction
                if(await pastSwap._syncStateFromBitcoin(false)) changed ||= true;
            }

            if(
                pastSwap.state===SpvFromBTCSwapState.CREATED ||
                pastSwap.state===SpvFromBTCSwapState.SIGNED ||
                pastSwap.state===SpvFromBTCSwapState.POSTED
            ) {
                if(pastSwap.expiry<Date.now()) {
                    if(pastSwap.state===SpvFromBTCSwapState.CREATED) {
                        pastSwap.state = SpvFromBTCSwapState.QUOTE_EXPIRED;
                    } else {
                        pastSwap.state = SpvFromBTCSwapState.QUOTE_SOFT_EXPIRED;
                    }
                    changed ||= true;
                }
            }

            if(pastSwap.isQuoteExpired()) {
                removeSwaps.push(pastSwap);
                continue;
            }
            if(changed) changedSwaps.add(pastSwap);

            if(pastSwap.state===SpvFromBTCSwapState.BROADCASTED || pastSwap.state===SpvFromBTCSwapState.BTC_TX_CONFIRMED) {
                broadcastedOrConfirmedSwaps.push(pastSwap);
            }
        }

        const checkWithdrawalStateSwaps: SpvFromBTCSwap<T>[] = [];
        const _fronts = await this.contract.getFronterAddresses(broadcastedOrConfirmedSwaps.map(val => ({
            owner: val.vaultOwner,
            vaultId: val.vaultId,
            withdrawal: val.data
        })));
        const _vaultUtxos = await this.contract.getVaultLatestUtxos(broadcastedOrConfirmedSwaps.map(val => ({
            owner: val.vaultOwner,
            vaultId: val.vaultId
        })));
        for(const pastSwap of broadcastedOrConfirmedSwaps) {
            const fronterAddress = _fronts[pastSwap.data.getTxId()];
            const latestVaultUtxo = _vaultUtxos[pastSwap.vaultOwner]?.[pastSwap.vaultId.toString(10)];
            if(fronterAddress===undefined) this.logger.warn(`_checkPastSwaps(): No fronter address returned for ${pastSwap.data.getTxId()}`);
            if(latestVaultUtxo===undefined) this.logger.warn(`_checkPastSwaps(): No last vault utxo returned for ${pastSwap.data.getTxId()}`);
            if(await pastSwap._shouldCheckWithdrawalState(fronterAddress, latestVaultUtxo)) checkWithdrawalStateSwaps.push(pastSwap);
        }

        const withdrawalStates = await this.contract.getWithdrawalStates(
            checkWithdrawalStateSwaps.map(val => ({
                withdrawal: val.data,
                scStartBlockheight: val.genesisSmartChainBlockHeight
            }))
        );
        for(const pastSwap of checkWithdrawalStateSwaps) {
            const status = withdrawalStates[pastSwap.data.getTxId()];
            if(status==null) {
                this.logger.warn(`_checkPastSwaps(): No withdrawal state returned for ${pastSwap.data.getTxId()}`);
                continue;
            }
            this.logger.debug("syncStateFromChain(): status of "+pastSwap.data.btcTx.txid, status?.type);
            let changed = false;
            switch(status.type) {
                case SpvWithdrawalStateType.FRONTED:
                    pastSwap.frontTxId = status.txId;
                    pastSwap.state = SpvFromBTCSwapState.FRONTED;
                    changed ||= true;
                    break;
                case SpvWithdrawalStateType.CLAIMED:
                    pastSwap.claimTxId = status.txId;
                    pastSwap.state = SpvFromBTCSwapState.CLAIMED;
                    changed ||= true;
                    break;
                case SpvWithdrawalStateType.CLOSED:
                    pastSwap.state = SpvFromBTCSwapState.CLOSED;
                    changed ||= true;
                    break;
            }
            if(changed) changedSwaps.add(pastSwap);
        }

        return {
            changedSwaps: Array.from(changedSwaps),
            removeSwaps
        };
    }

}
