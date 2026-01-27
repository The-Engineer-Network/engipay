import {ChainIds, MultiChain} from "../../swaps/swapper/Swapper";

export type CoinType = {
    coinId: string;
    decimals: number;
};

export type CtorCoinTypes<T extends MultiChain> = {
    coinId: string,
    chains: {
        [chainId in keyof T]?: {
            address: string,
            decimals: number,
        }
    }
}[]

export type CoinTypes<T extends MultiChain> = {
    [chainId in keyof T]?: {
        [address: string]: CoinType
    }
}

export abstract class IPriceProvider<T extends MultiChain> {

    coinsMap: CoinTypes<T> = {};

    protected constructor(coins: CtorCoinTypes<T>) {
        for(let coinData of coins) {
            if(coinData.coinId==null) continue;
            for(let chainId in coinData.chains) {
                const {address, decimals} = coinData.chains[chainId];
                this.coinsMap[chainId] ??= {};
                (this.coinsMap[chainId] as any)[address.toString()] = {
                    coinId: coinData.coinId,
                    decimals
                };
            }
        }
    }

    /**
     * Fetches the price for a given token against BTC
     *
     * @param token
     * @param abortSignal
     * @protected
     * @returns Price per token in uSats (micro sats)
     */
    protected abstract fetchPrice(token: CoinType, abortSignal?: AbortSignal): Promise<bigint>;

    /**
     * Fetches the USD price of BTC
     *
     * @param abortSignal
     * @protected
     */
    protected abstract fetchUsdPrice(abortSignal?: AbortSignal): Promise<number>;

    /**
     * Returns coin price in uSat (microSat)
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @throws {Error} if token is not found
     */
    getPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint> {
        let tokenAddress: string = token.toString();

        const chainTokens = this.coinsMap[chainIdentifier];
        if(chainTokens==null) throw new Error("Chain not found");
        const coin = chainTokens[tokenAddress];
        if(coin==null) throw new Error("Token not found");

        if(coin.coinId.startsWith("$fixed-")) {
            const amt: number = parseFloat(coin.coinId.substring(7));
            return Promise.resolve(BigInt(Math.floor(amt*1000000).toString(10)));
        }

        return this.fetchPrice(coin, abortSignal);
    }

    /**
     * Returns coin price in uSat (microSat)
     *
     * @param abortSignal
     * @throws {Error} if token is not found
     */
    getUsdPrice(abortSignal?: AbortSignal): Promise<number> {
        return this.fetchUsdPrice(abortSignal);
    }

    /**
     * Returns the decimal places of the specified token, or -1 if token should be ignored, returns null if
     *  token is not found
     *
     * @param chainIdentifier
     * @param token
     * @protected
     * @throws {Error} If token is not found
     */
    getDecimals<C extends ChainIds<T>>(chainIdentifier: C, token: string): number {
        const chainTokens = this.coinsMap[chainIdentifier];
        if(chainTokens==null) throw new Error("Chain not found");
        const coin = chainTokens[token.toString()];
        if(coin==null) throw new Error("Token not found");

        return coin.coinId==="$ignore" ? -1 : coin.decimals;
    }

}