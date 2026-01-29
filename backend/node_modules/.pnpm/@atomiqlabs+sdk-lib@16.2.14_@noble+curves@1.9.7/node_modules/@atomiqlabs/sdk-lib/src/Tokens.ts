import {ISwapPrice} from "./prices/abstract/ISwapPrice";

export type BtcToken<L = boolean> = {
    chain: "BTC",
    lightning: L,
    ticker: "BTC",
    decimals: 8,
    name: L extends true ? "Bitcoin (lightning L2)" : "Bitcoin (on-chain L1)",
    displayDecimals?: number
};

export function isBtcToken(obj: any): obj is BtcToken {
    return typeof(obj)==="object" &&
        obj.chain==="BTC" &&
        typeof(obj.lightning)==="boolean" &&
        typeof(obj.ticker)==="string" &&
        typeof(obj.decimals)==="number" &&
        typeof(obj.name)==="string";
}

export const BitcoinTokens: {
    BTC: BtcToken<false>,
    BTCLN: BtcToken<true>
} = {
    BTC: {
        chain: "BTC",
        lightning: false,
        ticker: "BTC",
        decimals: 8,
        name: "Bitcoin (on-chain L1)"
    },
    BTCLN: {
        chain: "BTC",
        lightning: true,
        ticker: "BTC",
        decimals: 8,
        name: "Bitcoin (lightning L2)"
    }
};

export type SCToken<ChainIdentifier extends string = string> = {
    chain: "SC",
    chainId: ChainIdentifier,
    address: string,
    ticker: string,
    decimals: number,
    displayDecimals?: number,
    name: string
}

export function isSCToken(obj: any): obj is SCToken {
    return typeof(obj)==="object" &&
        obj.chain==="SC" &&
        typeof(obj.chainId)==="string" &&
        typeof(obj.address)==="string" &&
        typeof(obj.ticker)==="string" &&
        typeof(obj.decimals)==="number" &&
        typeof(obj.name)==="string";
}

export type Token<ChainIdentifier extends string = string> = BtcToken | SCToken<ChainIdentifier>;

export function isToken(obj: any): obj is Token {
    return isBtcToken(obj) || isSCToken(obj);
}

export type TokenAmount<
    ChainIdentifier extends string = string,
    T extends Token<ChainIdentifier> = Token<ChainIdentifier>
> = {
    rawAmount: bigint,
    amount: string,
    _amount: number,
    token: T,
    usdValue: (abortSignal?: AbortSignal, preFetchedUsdPrice?: number) => Promise<number>,
    toString: () => string
};

export function fromDecimal(amount: string, decimalCount: number) {
    if(amount.includes(".")) {
        const [before, after] = amount.split(".");
        if(decimalCount<0) {
            return BigInt(before.substring(0, before.length+decimalCount));
        }
        if(after.length>decimalCount) {
            //Cut the last digits
            return BigInt((before==="0" ? "" : before)+after.substring(0, decimalCount));
        }
        return BigInt((before==="0" ? "" : before)+after.padEnd(decimalCount, "0"));
    } else {
        if(decimalCount<0) {
            return BigInt(amount.substring(0, amount.length+decimalCount));
        } else {
            return BigInt(amount+"0".repeat(decimalCount));
        }
    }

}

export function toDecimal(amount: bigint, decimalCount: number, cut?: boolean, displayDecimals?: number) {
    if(decimalCount<=0) {
        return amount.toString(10)+"0".repeat(-decimalCount);
    }

    const amountStr = amount.toString(10).padStart(decimalCount+1, "0");

    const splitPoint = amountStr.length-decimalCount;

    const decimalPart = amountStr.substring(splitPoint, amountStr.length);
    let cutTo = decimalPart.length;
    if(cut && cutTo>0) {
        for(let i=decimalPart.length-1;i--;i>=0) {
            if(decimalPart.charAt(i)==="0") {
                cutTo = i;
            } else break;
        }
        if(cutTo===0) cutTo = 1;
    }

    if(displayDecimals===0) return amountStr.substring(0, splitPoint);
    if(displayDecimals!=null && cutTo > displayDecimals) cutTo = displayDecimals;
    return amountStr.substring(0, splitPoint)+"."+decimalPart.substring(0, cutTo);
}

export function toTokenAmount<
    ChainIdentifier extends string = string,
    T extends Token<ChainIdentifier> = Token<ChainIdentifier>
>(
    amount: bigint,
    token:  T,
    prices: ISwapPrice
): TokenAmount<ChainIdentifier, T> {
    if(amount==null) return {
        rawAmount: null,
        amount: null,
        _amount: null,
        token,
        usdValue: () => Promise.resolve(null),
        toString: () => "??? "+token.ticker
    };
    let amountStr = toDecimal(amount, token.decimals, undefined, token.displayDecimals);
    return {
        rawAmount: amount,
        amount: amountStr,
        _amount: parseFloat(amountStr),
        token,
        usdValue: (abortSignal?: AbortSignal, preFetchedUsdPrice?: number) =>
            prices.getUsdValue(amount, token, abortSignal, preFetchedUsdPrice),
        toString: () => amountStr+" "+token.ticker
    };
}
