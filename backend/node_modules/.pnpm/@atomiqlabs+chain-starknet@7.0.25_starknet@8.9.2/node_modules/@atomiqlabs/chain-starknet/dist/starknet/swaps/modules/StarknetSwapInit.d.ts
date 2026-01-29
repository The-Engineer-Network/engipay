import { StarknetSwapData } from "../StarknetSwapData";
import { StarknetSwapModule } from "../StarknetSwapModule";
import { StarknetSigner } from "../../wallet/StarknetSigner";
import { StarknetTx } from "../../chain/modules/StarknetTransactions";
export type StarknetPreFetchVerification = {
    pendingBlockTime?: number;
};
export declare class StarknetSwapInit extends StarknetSwapModule {
    private static readonly GasCosts;
    /**
     * bare Init action based on the data passed in swapData
     *
     * @param signer
     * @param swapData
     * @param timeout
     * @param signature
     * @private
     */
    private Init;
    /**
     * Returns auth prefix to be used with a specific swap, payIn=true & payIn=false use different prefixes (these
     *  actually have no meaning for the smart contract/solana program in the Solana case)
     *
     * @param swapData
     * @private
     */
    private getAuthPrefix;
    preFetchForInitSignatureVerification(): Promise<StarknetPreFetchVerification>;
    /**
     * Signs swap initialization authorization, using data from preFetchedBlockData if provided & still valid (subject
     *  to SIGNATURE_PREFETCH_DATA_VALIDITY)
     *
     * @param signer
     * @param swapData
     * @param authorizationTimeout
     * @public
     */
    signSwapInitialization(signer: StarknetSigner, swapData: StarknetSwapData, authorizationTimeout: number): Promise<{
        prefix: string;
        timeout: string;
        signature: string;
    }>;
    /**
     * Checks whether the provided signature data is valid, using preFetchedData if provided and still valid
     *
     * @param sender
     * @param swapData
     * @param timeout
     * @param prefix
     * @param signature
     * @param preFetchData
     * @public
     */
    isSignatureValid(sender: string, swapData: StarknetSwapData, timeout: string, prefix: string, signature: string, preFetchData?: StarknetPreFetchVerification): Promise<null>;
    /**
     * Gets expiry of the provided signature data, this is a minimum of slot expiry & swap signature expiry
     *
     * @param timeout
     * @public
     */
    getSignatureExpiry(timeout: string): Promise<number>;
    /**
     * Checks whether signature is soft expired, compares the timestamp to the current "pre-confirmed" block timestamp
     *
     * @param timeout
     * @param preFetchData
     * @public
     */
    isSignatureSoftExpired(timeout: string, preFetchData?: StarknetPreFetchVerification): Promise<boolean>;
    /**
     * Checks whether signature is expired for good, compares the timestamp to the current "latest" block timestamp
     *
     * @param timeout
     * @public
     */
    isSignatureExpired(timeout: string): Promise<boolean>;
    /**
     * Creates init transaction with a valid signature from an LP
     *
     * @param sender
     * @param swapData swap to initialize
     * @param timeout init signature timeout
     * @param prefix init signature prefix
     * @param signature init signature
     * @param skipChecks whether to skip signature validity checks
     * @param feeRate fee rate to use for the transaction
     */
    txsInit(sender: string, swapData: StarknetSwapData, timeout: string, prefix: string, signature: string, skipChecks?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    /**
     * Get the estimated solana fee of the init transaction, this includes the required deposit for creating swap PDA
     *  and also deposit for ATAs
     */
    getInitFee(swapData?: StarknetSwapData, feeRate?: string): Promise<bigint>;
}
