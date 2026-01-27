import { StarknetModule } from "../StarknetModule";
import { StarknetAction } from "../StarknetAction";
export declare class StarknetTokens extends StarknetModule {
    static readonly ERC20_ETH = "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
    static readonly ERC20_STRK = "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
    static readonly GasCosts: {
        TRANSFER: {
            l1DataGas: number;
            l2Gas: number;
            l1Gas: number;
        };
        APPROVE: {
            l1DataGas: number;
            l2Gas: number;
            l1Gas: number;
        };
    };
    private getContract;
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
    private Transfer;
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
    Approve(signer: string, spender: string, token: string, amount: bigint): StarknetAction;
    /**
     * Checks if the provided string is a valid starknet token
     *
     * @param token
     */
    isValidToken(token: string): boolean;
    /**
     * Returns the token balance of the address
     *
     * @param address
     * @param token
     */
    getTokenBalance(address: string, token: string): Promise<bigint>;
    /**
     * Returns the native currency address, return the default used by the fee module
     */
    getNativeCurrencyAddress(): string;
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
    txsTransfer(signer: string, token: string, amount: bigint, recipient: string, feeRate?: string): Promise<import("./StarknetTransactions").StarknetTx[]>;
}
