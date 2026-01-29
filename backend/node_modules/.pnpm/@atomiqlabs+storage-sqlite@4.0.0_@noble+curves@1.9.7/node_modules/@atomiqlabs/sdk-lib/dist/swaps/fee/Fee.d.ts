import { Token, TokenAmount } from "../../Tokens";
import { PercentagePPM } from "../ISwap";
export type Fee<ChainIdentifier extends string = string, TSrc extends Token<ChainIdentifier> = Token<ChainIdentifier>, TDst extends Token<ChainIdentifier> = Token<ChainIdentifier>> = {
    amountInSrcToken: TokenAmount<ChainIdentifier, TSrc>;
    amountInDstToken: TokenAmount<ChainIdentifier, TDst>;
    usdValue: (abortSignal?: AbortSignal, preFetchedUsdPrice?: number) => Promise<number>;
    composition?: {
        base: TokenAmount<ChainIdentifier>;
        percentage: PercentagePPM;
    };
};
export declare enum FeeType {
    SWAP = 0,
    NETWORK_OUTPUT = 1
}
export type FeeBreakdown<ChainIdentifier extends string = string> = {
    type: FeeType;
    fee: Fee<ChainIdentifier>;
}[];
