import { IntermediaryReputationType } from "@atomiqlabs/base";
import { StarknetSwapModule } from "../StarknetSwapModule";
import { StarknetTx } from "../../chain/modules/StarknetTransactions";
export declare class StarknetLpVault extends StarknetSwapModule {
    private static readonly GasCosts;
    /**
     * Action for withdrawing funds from the LP vault
     *
     * @param signer
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    private Withdraw;
    /**
     * Action for depositing funds to the LP vault
     *
     * @param signer
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    private Deposit;
    /**
     * Returns intermediary's reputation & vault balance for a specific token
     *
     * @param address
     * @param token
     */
    getIntermediaryData(address: string, token: string): Promise<{
        balance: bigint;
        reputation: IntermediaryReputationType;
    }>;
    /**
     * Returns intermediary's reputation for a specific token
     *
     * @param address
     * @param token
     */
    getIntermediaryReputation(address: string, token: string): Promise<IntermediaryReputationType>;
    /**
     * Returns the balance of the token an intermediary has in his LP vault
     *
     * @param address
     * @param token
     */
    getIntermediaryBalance(address: string, token: string): Promise<bigint>;
    /**
     * Creates transactions for withdrawing funds from the LP vault, creates ATA if it doesn't exist and unwraps
     *  WSOL to SOL if required
     *
     * @param signer
     * @param token
     * @param amount
     * @param feeRate
     */
    txsWithdraw(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]>;
    /**
     * Creates transaction for depositing funds into the LP vault, wraps SOL to WSOL if required
     *
     * @param signer
     * @param token
     * @param amount
     * @param feeRate
     */
    txsDeposit(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]>;
}
