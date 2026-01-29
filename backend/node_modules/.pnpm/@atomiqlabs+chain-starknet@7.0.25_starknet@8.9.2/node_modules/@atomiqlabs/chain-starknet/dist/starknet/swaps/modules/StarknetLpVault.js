"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetLpVault = void 0;
const Utils_1 = require("../../../utils/Utils");
const StarknetSwapModule_1 = require("../StarknetSwapModule");
const StarknetAction_1 = require("../../chain/StarknetAction");
const starknet_1 = require("starknet");
class StarknetLpVault extends StarknetSwapModule_1.StarknetSwapModule {
    /**
     * Action for withdrawing funds from the LP vault
     *
     * @param signer
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    Withdraw(signer, token, amount) {
        return new StarknetAction_1.StarknetAction(signer, this.root, this.swapContract.populateTransaction.withdraw(token, starknet_1.cairo.uint256(amount), signer), StarknetLpVault.GasCosts.WITHDRAW);
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
    Deposit(signer, token, amount) {
        return new StarknetAction_1.StarknetAction(signer, this.root, this.swapContract.populateTransaction.deposit(token, starknet_1.cairo.uint256(amount)), StarknetLpVault.GasCosts.WITHDRAW);
    }
    /**
     * Returns intermediary's reputation & vault balance for a specific token
     *
     * @param address
     * @param token
     */
    async getIntermediaryData(address, token) {
        const [balance, reputation] = await Promise.all([
            this.getIntermediaryBalance(address, token),
            this.getIntermediaryReputation(address, token)
        ]);
        return { balance, reputation };
    }
    /**
     * Returns intermediary's reputation for a specific token
     *
     * @param address
     * @param token
     */
    async getIntermediaryReputation(address, token) {
        const filter = Object.keys(this.contract.claimHandlersByAddress).map(claimHandler => starknet_1.cairo.tuple(address, token, claimHandler));
        const rawReputation = await this.provider.callContract(this.swapContract.populateTransaction.get_reputation(filter));
        const length = (0, Utils_1.toBigInt)(rawReputation.shift());
        if (Number(length) !== filter.length)
            throw new Error("getIntermediaryReputation(): Invalid response length");
        const result = {};
        Object.keys(this.contract.claimHandlersByAddress).forEach((address) => {
            const handler = this.contract.claimHandlersByAddress[address];
            result[handler.getType()] = {
                successVolume: (0, Utils_1.toBigInt)({ low: rawReputation.shift(), high: rawReputation.shift() }),
                successCount: (0, Utils_1.toBigInt)(rawReputation.shift()),
                coopCloseVolume: (0, Utils_1.toBigInt)({ low: rawReputation.shift(), high: rawReputation.shift() }),
                coopCloseCount: (0, Utils_1.toBigInt)(rawReputation.shift()),
                failVolume: (0, Utils_1.toBigInt)({ low: rawReputation.shift(), high: rawReputation.shift() }),
                failCount: (0, Utils_1.toBigInt)(rawReputation.shift()),
            };
        });
        return result;
    }
    /**
     * Returns the balance of the token an intermediary has in his LP vault
     *
     * @param address
     * @param token
     */
    async getIntermediaryBalance(address, token) {
        const balance = (0, Utils_1.toBigInt)((await this.swapContract.get_balance([starknet_1.cairo.tuple(address, token)]))[0]);
        this.logger.debug("getIntermediaryBalance(): token LP balance fetched, token: " + token.toString() +
            " address: " + address + " amount: " + (balance == null ? "null" : balance.toString()));
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
    async txsWithdraw(signer, token, amount, feeRate) {
        const action = await this.Withdraw(signer, token, amount);
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        this.logger.debug("txsWithdraw(): withdraw TX created, token: " + token.toString() +
            " amount: " + amount.toString(10));
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
    async txsDeposit(signer, token, amount, feeRate) {
        //Approve first
        const action = await this.root.Tokens.Approve(signer, this.swapContract.address, token, amount);
        action.add(this.Deposit(signer, token, amount));
        feeRate ?? (feeRate = await this.root.Fees.getFeeRate());
        this.logger.debug("txsDeposit(): deposit TX created, token: " + token.toString() +
            " amount: " + amount.toString(10));
        return [await action.tx(feeRate)];
    }
}
exports.StarknetLpVault = StarknetLpVault;
StarknetLpVault.GasCosts = {
    WITHDRAW: { l1DataGas: 500, l2Gas: 3200000, l1Gas: 0 },
    DEPOSIT: { l1: 500, l2Gas: 4000000, l1Gas: 0 }
};
