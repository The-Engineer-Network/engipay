import { StarknetSwapModule } from "../StarknetSwapModule";
import { StarknetSwapData } from "../StarknetSwapData";
import { StarknetTx } from "../../chain/modules/StarknetTransactions";
import { StarknetSigner } from "../../wallet/StarknetSigner";
export declare class StarknetSwapRefund extends StarknetSwapModule {
    private static readonly GasCosts;
    /**
     * Action for generic Refund instruction
     *
     * @param signer
     * @param swapData
     * @param witness
     * @param handlerGas
     * @constructor
     * @private
     */
    private Refund;
    /**
     * Action for cooperative refunding with signature
     *
     * @param sender
     * @param swapData
     * @param timeout
     * @param signature
     * @constructor
     * @private
     */
    private RefundWithSignature;
    signSwapRefund(signer: StarknetSigner, swapData: StarknetSwapData, authorizationTimeout: number): Promise<{
        prefix: string;
        timeout: string;
        signature: string;
    }>;
    isSignatureValid(swapData: StarknetSwapData, timeout: string, prefix: string, signature: string): Promise<null>;
    /**
     * Creates transactions required for refunding timed out swap
     *
     * @param signer
     * @param swapData swap data to refund
     * @param check whether to check if swap is already expired and refundable
     * @param feeRate fee rate to be used for the transactions
     * @param witnessData
     */
    txsRefund<T>(signer: string, swapData: StarknetSwapData, check?: boolean, feeRate?: string, witnessData?: T): Promise<StarknetTx[]>;
    /**
     * Creates transactions required for refunding the swap with authorization signature, also unwraps WSOL to SOL
     *
     * @param signer
     * @param swapData swap data to refund
     * @param timeout signature timeout
     * @param prefix signature prefix of the counterparty
     * @param signature signature of the counterparty
     * @param check whether to check if swap is committed before attempting refund
     * @param feeRate fee rate to be used for the transactions
     */
    txsRefundWithAuthorization(signer: string, swapData: StarknetSwapData, timeout: string, prefix: string, signature: string, check?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    /**
     * Get the estimated solana transaction fee of the refund transaction, in the worst case scenario in case where the
     *  ATA needs to be initialized again (i.e. adding the ATA rent exempt lamports to the fee)
     */
    getRefundFee(swapData: StarknetSwapData, feeRate?: string): Promise<bigint>;
}
