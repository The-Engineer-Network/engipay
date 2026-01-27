import { RelaySynchronizer } from "@atomiqlabs/base";
import { StarknetSwapModule } from "../StarknetSwapModule";
import { StarknetSwapData } from "../StarknetSwapData";
import { StarknetTx } from "../../chain/modules/StarknetTransactions";
import { StarknetBtcStoredHeader } from "../../btcrelay/headers/StarknetBtcStoredHeader";
export declare class StarknetSwapClaim extends StarknetSwapModule {
    private static readonly GasCosts;
    /**
     * Claim action which uses the provided witness for claiming the swap
     *
     * @param signer
     * @param swapData
     * @param witness
     * @param claimHandlerGas
     * @constructor
     * @private
     */
    private Claim;
    /**
     * Creates transactions claiming the swap using a secret (for HTLC swaps)
     *
     * @param signer
     * @param swapData swap to claim
     * @param secret hex encoded secret pre-image to the HTLC hash
     * @param checkExpiry whether to check if the swap is already expired (trying to claim an expired swap with a secret
     *  is dangerous because we might end up revealing the secret to the counterparty without being able to claim the swap)
     * @param feeRate fee rate to use for the transaction
     */
    txsClaimWithSecret(signer: string, swapData: StarknetSwapData, secret: string, checkExpiry?: boolean, feeRate?: string): Promise<StarknetTx[]>;
    /**
     * Creates transaction claiming the swap using a confirmed transaction data (for BTC on-chain swaps)
     *
     * @param signer
     * @param swapData swap to claim
     * @param tx bitcoin transaction that satisfies the swap condition
     * @param requiredConfirmations
     * @param vout vout of the bitcoin transaction that satisfies the swap condition
     * @param commitedHeader commited header data from btc relay (fetched internally if null)
     * @param synchronizer optional synchronizer to use in case we need to sync up the btc relay ourselves
     * @param feeRate fee rate to be used for the transactions
     */
    txsClaimWithTxData(signer: string, swapData: StarknetSwapData, tx: {
        blockhash: string;
        confirmations: number;
        txid: string;
        hex: string;
        height: number;
    }, requiredConfirmations: number, vout: number, commitedHeader?: StarknetBtcStoredHeader, synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>, feeRate?: string): Promise<StarknetTx[] | null>;
    /**
     * Get the estimated starknet transaction fee of the claim transaction
     */
    getClaimFee(swapData: StarknetSwapData, feeRate?: string): Promise<bigint>;
}
