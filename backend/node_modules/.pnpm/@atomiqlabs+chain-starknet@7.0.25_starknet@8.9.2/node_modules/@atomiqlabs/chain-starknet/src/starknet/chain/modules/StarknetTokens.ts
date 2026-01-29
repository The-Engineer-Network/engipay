import {StarknetModule} from "../StarknetModule";
import {StarknetAction} from "../StarknetAction";
import {ERC20Abi} from "./ERC20Abi";
import { Contract } from "starknet";
import {toBigInt} from "../../../utils/Utils";
import {StarknetAddresses} from "./StarknetAddresses";


export class StarknetTokens extends StarknetModule {

    public static readonly ERC20_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    public static readonly ERC20_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";

    public static readonly GasCosts = {
        TRANSFER: {l1DataGas: 400, l2Gas: 4_000_000, l1Gas: 0},
        APPROVE: {l1DataGas: 400, l2Gas: 4_000_000, l1Gas: 0}
    };

    private getContract(address: string) {
        return new Contract({
            abi: ERC20Abi,
            address: address,
            providerOrAccount: this.root.provider
        }).typedv2(ERC20Abi);
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
    private Transfer(signer: string, recipient: string, token: string, amount: bigint): StarknetAction {
        const erc20 = this.getContract(token);
        return new StarknetAction(signer, this.root,
            erc20.populateTransaction.transfer(recipient, amount),
            StarknetTokens.GasCosts.TRANSFER
        );
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
    public Approve(signer: string, spender: string, token: string, amount: bigint): StarknetAction {
        const erc20 = this.getContract(token);
        return new StarknetAction(signer, this.root,
            erc20.populateTransaction.approve(spender, amount),
            StarknetTokens.GasCosts.APPROVE
        );
    }

    ///////////////////
    //// Tokens
    /**
     * Checks if the provided string is a valid starknet token
     *
     * @param token
     */
    public isValidToken(token: string) {
        return StarknetAddresses.isValidAddress(token);
    }

    /**
     * Returns the token balance of the address
     *
     * @param address
     * @param token
     */
    public async getTokenBalance(address: string, token: string): Promise<bigint> {
        const erc20 = this.getContract(token);
        const balance = await erc20.balance_of(address);
        const balanceBN = toBigInt(balance);

        this.logger.debug("getTokenBalance(): token balance fetched, token: "+token+
            " address: "+address+" amount: "+balanceBN.toString());

        return balanceBN;
    }

    /**
     * Returns the native currency address, return the default used by the fee module
     */
    public getNativeCurrencyAddress(): string {
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
    public async txsTransfer(signer: string, token: string, amount: bigint, recipient: string, feeRate?: string) {
        const action = this.Transfer(signer, recipient, token, amount);

        feeRate = feeRate ?? await this.root.Fees.getFeeRate();

        this.logger.debug("txsTransfer(): transfer TX created, recipient: "+recipient.toString()+
            " token: "+token.toString()+ " amount: "+amount.toString(10));

        return [await action.tx(feeRate)];
    }

}