import { ISwapPrice } from "./prices/abstract/ISwapPrice";
export type BtcToken<L = boolean> = {
    chain: "BTC";
    lightning: L;
    ticker: "BTC";
    decimals: 8;
    name: L extends true ? "Bitcoin (lightning L2)" : "Bitcoin (on-chain L1)";
    displayDecimals?: number;
};
export declare function isBtcToken(obj: any): obj is BtcToken;
export declare const BitcoinTokens: {
    BTC: BtcToken<false>;
    BTCLN: BtcToken<true>;
};
export type SCToken<ChainIdentifier extends string = string> = {
    chain: "SC";
    chainId: ChainIdentifier;
    address: string;
    ticker: string;
    decimals: number;
    displayDecimals?: number;
    name: string;
};
export declare function isSCToken(obj: any): obj is SCToken;
export type Token<ChainIdentifier extends string = string> = BtcToken | SCToken<ChainIdentifier>;
export declare function isToken(obj: any): obj is Token;
export type TokenAmount<ChainIdentifier extends string = string, T extends Token<ChainIdentifier> = Token<ChainIdentifier>> = {
    rawAmount: bigint;
    amount: string;
    _amount: number;
    token: T;
    usdValue: (abortSignal?: AbortSignal, preFetchedUsdPrice?: number) => Promise<number>;
    toString: () => string;
};
export declare function fromDecimal(amount: string, decimalCount: number): bigint;
export declare function toDecimal(amount: bigint, decimalCount: number, cut?: boolean, displayDecimals?: number): string;
export declare function toTokenAmount<ChainIdentifier extends string = string, T extends Token<ChainIdentifier> = Token<ChainIdentifier>>(amount: bigint, token: T, prices: ISwapPrice): TokenAmount<ChainIdentifier, T>;
