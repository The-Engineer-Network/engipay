"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetTokens = void 0;
const StarknetModule_1 = require("../StarknetModule");
const StarknetAction_1 = require("../StarknetAction");
const ERC20Abi_1 = require("./ERC20Abi");
const starknet_1 = require("starknet");
const Utils_1 = require("../../../utils/Utils");
const StarknetAddresses_1 = require("./StarknetAddresses");
class StarknetTokens extends StarknetModule_1.StarknetModule {
    getContract(address) {
        return new starknet_1.Contract({
            abi: ERC20Abi_1.ERC20Abi,
            address: address,
            providerOrAccount: this.root.provider
        }).typedv2(ERC20Abi_1.ERC20Abi);
    }
    /**
     * Action for transferring the erc20 token
     *
     * @param signer
     * @param recipient
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    Transfer(signer, recipient, token, amount) {
        const erc20 = this.getContract(token);
        return new StarknetAction_1.StarknetAction(signer, this.root, erc20.populateTransaction.transfer(recipient, amount), StarknetTokens.GasCosts.TRANSFER);
    }
    /**
     * Approves spend of tokens for a specific spender
     *
     * @param signer
     * @param spender
     * @param token
     * @param amount
     * @constructor
     * @private
     */
    Approve(signer, spender, token, amount) {
        const erc20 = this.getContract(token);
        return new StarknetAction_1.StarknetAction(signer, this.root, erc20.populateTransaction.approve(spender, amount), StarknetTokens.GasCosts.APPROVE);
    }
    ///////////////////
    //// Tokens
    /**
     * Checks if the provided string is a valid starknet token
     *
     * @param token
     */
    isValidToken(token) {
        return StarknetAddresses_1.StarknetAddresses.isValidAddress(token);
    }
    /**
     * Returns the token balance of the address
     *
     * @param address
     * @param token
     */
    async getTokenBalance(address, token) {
        const erc20 = this.getContract(token);
        const balance = await erc20.balance_of(address);
        const balanceBN = (0, Utils_1.toBigInt)(balance);
        this.logger.debug("getTokenBalance(): token balance fetched, token: " + token +
            " address: " + address + " amount: " + balanceBN.toString());
        return balanceBN;
    }
    /**
     * Returns the native currency address, return the default used by the fee module
     */
    getNativeCurrencyAddress() {
        return this.root.Fees.getDefaultGasToken();
    }
    ///////////////////
    //// Transfers
    /**
     * Creates transactions for sending the over the tokens
     *
     * @param signer
     * @param token token to send
     * @param amount amount of the token to send
     * @param recipient recipient's address
     * @param feeRate fee rate to use for the transactions
     * @private
     */
    async txsTransfer(signer, token, amount, recipient, feeRate) {
        const action = this.Transfer(signer, recipient, token, amount);
        feeRate = feeRate ?? await this.root.Fees.getFeeRate();
        this.logger.debug("txsTransfer(): transfer TX created, recipient: " + recipient.toString() +
            " token: " + token.toString() + " amount: " + amount.toString(10));
        return [await action.tx(feeRate)];
    }
}
exports.StarknetTokens = StarknetTokens;
StarknetTokens.ERC20_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
StarknetTokens.ERC20_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
StarknetTokens.GasCosts = {
    TRANSFER: { l1DataGas: 400, l2Gas: 4000000, l1Gas: 0 },
    APPROVE: { l1DataGas: 400, l2Gas: 4000000, l1Gas: 0 }
};
