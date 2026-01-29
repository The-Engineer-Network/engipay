import {toBigInt} from "../../../utils/Utils";
import { IntermediaryReputationType } from "@atomiqlabs/base";
import {StarknetSwapModule} from "../StarknetSwapModule";
import {StarknetAction} from "../../chain/StarknetAction";
import {cairo} from "starknet";
import {StarknetTx} from "../../chain/modules/StarknetTransactions";

export class StarknetLpVault extends StarknetSwapModule {

    private static readonly GasCosts = {
        WITHDRAW: {l1DataGas: 500, l2Gas: 3_200_000, l1Gas: 0},
        DEPOSIT: {l1: 500, l2Gas: 4_000_000, l1Gas: 0}
    };

    /**
     * Action for withdrawing funds from the LP vault
     *
     * @param signer
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    private Withdraw(signer: string, token: string, amount: bigint): StarknetAction {
        return new StarknetAction(signer, this.root,
            this.swapContract.populateTransaction.withdraw(token, cairo.uint256(amount), signer),
            StarknetLpVault.GasCosts.WITHDRAW
        );
    }

    /**
     * Action for depositing funds to the LP vault
     *
     * @param signer
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    private Deposit(signer: string, token: string, amount: bigint): StarknetAction {
        return new StarknetAction(signer, this.root,
            this.swapContract.populateTransaction.deposit(token, cairo.uint256(amount)),
            StarknetLpVault.GasCosts.WITHDRAW
        );
    }

    /**
     * Returns intermediary's reputation & vault balance for a specific token
     *
     * @param address
     * @param token
     */
    public async getIntermediaryData(address: string, token: string): Promise<{
        balance: bigint,
        reputation: IntermediaryReputationType
    }> {
        const [balance, reputation] = await Promise.all([
            this.getIntermediaryBalance(address, token),
            this.getIntermediaryReputation(address, token)
        ]);

        return {balance, reputation};
    }

    /**
     * Returns intermediary's reputation for a specific token
     *
     * @param address
     * @param token
     */
    public async getIntermediaryReputation(address: string, token: string): Promise<IntermediaryReputationType> {
        const filter = Object.keys(this.contract.claimHandlersByAddress).map(claimHandler => cairo.tuple(address, token, claimHandler));
        const rawReputation = await this.provider.callContract(this.swapContract.populateTransaction.get_reputation(filter));
        const length = toBigInt(rawReputation.shift());
        if(Number(length)!==filter.length) throw new Error("getIntermediaryReputation(): Invalid response length");

        const result: any = {};
        Object.keys(this.contract.claimHandlersByAddress).forEach((address) => {
            const handler = this.contract.claimHandlersByAddress[address];
            result[handler.getType()] = {
                successVolume: toBigInt({low: rawReputation.shift(), high: rawReputation.shift()}),
                successCount: toBigInt(rawReputation.shift()),
                coopCloseVolume: toBigInt({low: rawReputation.shift(), high: rawReputation.shift()}),
                coopCloseCount: toBigInt(rawReputation.shift()),
                failVolume: toBigInt({low: rawReputation.shift(), high: rawReputation.shift()}),
                failCount: toBigInt(rawReputation.shift()),
            };
        });
        return result as any;
    }

    /**
     * Returns the balance of the token an intermediary has in his LP vault
     *
     * @param address
     * @param token
     */
    public async getIntermediaryBalance(address: string, token: string): Promise<bigint> {
        const balance = toBigInt((await this.swapContract.get_balance([cairo.tuple(address, token)]))[0]);

        this.logger.debug("getIntermediaryBalance(): token LP balance fetched, token: "+token.toString()+
            " address: "+address+" amount: "+(balance==null ? "null" : balance.toString()));

        return balance;
    }

    /**
     * Creates transactions for withdrawing funds from the LP vault, creates ATA if it doesn't exist and unwraps
     *  WSOL to SOL if required
     *
     * @param signer
     * @param token
     * @param amount
     * @param feeRate
     */
    public async txsWithdraw(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]> {
        const action = await this.Withdraw(signer, token, amount);

        feeRate ??= await this.root.Fees.getFeeRate();

        this.logger.debug("txsWithdraw(): withdraw TX created, token: "+token.toString()+
            " amount: "+amount.toString(10));

        return [await action.tx(feeRate)];
    }

    /**
     * Creates transaction for depositing funds into the LP vault, wraps SOL to WSOL if required
     *
     * @param signer
     * @param token
     * @param amount
     * @param feeRate
     */
    public async txsDeposit(signer: string, token: string, amount: bigint, feeRate?: string): Promise<StarknetTx[]> {
        //Approve first
        const action = await this.root.Tokens.Approve(signer, this.swapContract.address, token, amount);
        action.add(this.Deposit(signer, token, amount));

        feeRate ??= await this.root.Fees.getFeeRate();

        this.logger.debug("txsDeposit(): deposit TX created, token: "+token.toString()+
            " amount: "+amount.toString(10));

        return [await action.tx(feeRate)];
    }

}