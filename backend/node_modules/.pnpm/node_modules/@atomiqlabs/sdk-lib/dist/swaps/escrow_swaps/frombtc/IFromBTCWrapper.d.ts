import { AmountData, ISwapWrapperOptions } from "../../ISwapWrapper";
import { Intermediary } from "../../../intermediaries/Intermediary";
import { ChainType } from "@atomiqlabs/base";
import { IEscrowSwapWrapper } from "../IEscrowSwapWrapper";
import { IEscrowSwap } from "../IEscrowSwap";
export declare abstract class IFromBTCWrapper<T extends ChainType, S extends IEscrowSwap<T>, O extends ISwapWrapperOptions = ISwapWrapperOptions> extends IEscrowSwapWrapper<T, S, O> {
    /**
     * Returns a random sequence to be used for swaps
     *
     * @protected
     * @returns Random 64-bit sequence number
     */
    protected getRandomSequence(): bigint;
    /**
     * Pre-fetches feeRate for a given swap
     *
     * @param signer Address initiating the swap
     * @param amountData
     * @param claimHash optional claim hash of the swap or null
     * @param abortController
     * @protected
     * @returns Fee rate
     */
    protected preFetchFeeRate(signer: string, amountData: AmountData, claimHash: string | null, abortController: AbortController): Promise<any | null>;
    /**
     * Pre-fetches intermediary's available SC on-chain liquidity
     * @param amountData
     * @param lp Intermediary
     * @param abortController
     * @protected
     * @returns Intermediary's liquidity balance
     */
    protected preFetchIntermediaryLiquidity(amountData: AmountData, lp: Intermediary, abortController: AbortController): Promise<bigint | null>;
    /**
     * Verifies whether the intermediary has enough available liquidity such that we can initiate the swap
     *
     * @param amount Swap amount that we should receive
     * @param liquidityPromise pre-fetched liquidity promise as obtained from preFetchIntermediaryLiquidity()
     * @protected
     * @throws {IntermediaryError} if intermediary's liquidity is lower than what's required for the swap
     */
    protected verifyIntermediaryLiquidity(amount: bigint, liquidityPromise: Promise<bigint>): Promise<void>;
}
