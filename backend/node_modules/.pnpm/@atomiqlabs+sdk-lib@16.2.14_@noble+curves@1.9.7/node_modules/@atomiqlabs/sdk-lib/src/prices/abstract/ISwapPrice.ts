import {ChainIds, MultiChain} from "../../swaps/swapper/Swapper";
import {Token} from "../../Tokens";

export type PriceInfoType = {
    isValid: boolean,
    differencePPM: bigint,
    satsBaseFee: bigint,
    feePPM: bigint,
    realPriceUSatPerToken: bigint,
    swapPriceUSatPerToken: bigint
};

export function isPriceInfoType(obj: any): obj is PriceInfoType {
    return obj!=null &&
        typeof(obj.isValid) === "boolean" &&
        typeof(obj.differencePPM) === "bigint" &&
        typeof(obj.satsBaseFee) === "bigint" &&
        typeof(obj.feePPM) === "bigint" &&
        typeof(obj.realPriceUSatPerToken) === "bigint" &&
        typeof(obj.swapPriceUSatPerToken) === "bigint";
}

export abstract class ISwapPrice<T extends MultiChain = MultiChain> {

    maxAllowedFeeDifferencePPM: bigint;

    protected constructor(maxAllowedFeeDifferencePPM: bigint) {
        this.maxAllowedFeeDifferencePPM = maxAllowedFeeDifferencePPM;
    }

    /**
     * Gets the decimal places for a given token, returns -1 if token should be ignored & null if token is not found
     * @param chainIdentifier
     * @param token
     * @protected
     */
    protected abstract getDecimals<C extends ChainIds<T>>(chainIdentifier: C, token: string): number | null;

    /**
     * Returns the price of the token in BTC uSats (microSats)
     *
     * @param chainIdentifier
     * @param token
     * @param abortSignal
     * @protected
     */
    protected abstract getPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint>;

    /**
     * Returns the price of bitcoin in USD, (sats/USD)
     *
     * @param abortSignal
     * @protected
     */
    protected abstract getUsdPrice(abortSignal?: AbortSignal): Promise<number>;

    /**
     * Recomputes pricing info without fetching the current price
     *
     * @param chainIdentifier
     * @param amountSats
     * @param satsBaseFee
     * @param feePPM
     * @param paidToken
     * @param token
     */
    public recomputePriceInfoSend<C extends ChainIds<T>>(
        chainIdentifier: C,
        amountSats: bigint,
        satsBaseFee: bigint,
        feePPM: bigint,
        paidToken: bigint,
        token: string
    ): PriceInfoType {
        const totalSats = (amountSats * (1000000n + feePPM) / 1000000n)
            + satsBaseFee;
        const totalUSats = totalSats * 1000000n;
        const swapPriceUSatPerToken = totalUSats * (10n ** BigInt(this.getDecimals(chainIdentifier, token))) / paidToken;

        return {
            isValid: true,
            differencePPM: 0n,
            satsBaseFee,
            feePPM,
            realPriceUSatPerToken: this.shouldIgnore(chainIdentifier, token) ? null : swapPriceUSatPerToken,
            swapPriceUSatPerToken
        };
    }

    /**
     * Checks whether the swap amounts are valid given the current market rate for a given pair
     *
     * @param chainIdentifier
     * @param amountSats Amount of sats (BTC) to be received from the swap
     * @param satsBaseFee Base fee in sats (BTC) as reported by the intermediary
     * @param feePPM PPM fee rate as reported by the intermediary
     * @param paidToken Amount of token to be paid to the swap
     * @param token
     * @param abortSignal
     * @param preFetchedPrice Already pre-fetched price
     */
    public async isValidAmountSend<C extends ChainIds<T>>(
        chainIdentifier: C,
        amountSats: bigint,
        satsBaseFee: bigint,
        feePPM: bigint,
        paidToken: bigint,
        token: string,
        abortSignal?: AbortSignal,
        preFetchedPrice?: bigint
    ): Promise<PriceInfoType> {
        const totalSats = (amountSats * (1000000n + feePPM) / 1000000n)
            + satsBaseFee;
        const totalUSats = totalSats * 1000000n;
        const swapPriceUSatPerToken = totalUSats * (10n ** BigInt(this.getDecimals(chainIdentifier, token))) / paidToken;

        if(this.shouldIgnore(chainIdentifier, token)) return {
            isValid: true,
            differencePPM: 0n,
            satsBaseFee,
            feePPM,
            realPriceUSatPerToken: null,
            swapPriceUSatPerToken
        };

        const calculatedAmtInToken = await this.getFromBtcSwapAmount(chainIdentifier, totalSats, token, abortSignal, preFetchedPrice);
        const realPriceUSatPerToken = totalUSats * (10n ** BigInt(this.getDecimals(chainIdentifier, token))) / calculatedAmtInToken;

        const difference = paidToken - calculatedAmtInToken; //Will be >0 if we need to pay more than we should've
        const differencePPM = difference * 1000000n / calculatedAmtInToken;

        return {
            isValid: differencePPM <= this.maxAllowedFeeDifferencePPM,
            differencePPM,
            satsBaseFee,
            feePPM,
            realPriceUSatPerToken,
            swapPriceUSatPerToken
        };
    }

    /**
     * Recomputes pricing info without fetching the current price
     *
     * @param chainIdentifier
     * @param amountSats
     * @param satsBaseFee
     * @param feePPM
     * @param receiveToken
     * @param token
     */
    public recomputePriceInfoReceive<C extends ChainIds<T>>(
        chainIdentifier: C,
        amountSats: bigint,
        satsBaseFee: bigint,
        feePPM: bigint,
        receiveToken: bigint,
        token: string,
    ): PriceInfoType {
        const totalSats = (amountSats * (1000000n - feePPM) / 1000000n)
            - satsBaseFee;
        const totalUSats = totalSats * 1000000n;
        const swapPriceUSatPerToken = totalUSats * (10n ** BigInt(this.getDecimals(chainIdentifier, token))) / receiveToken;

        return {
            isValid: true,
            differencePPM: 0n,
            satsBaseFee,
            feePPM,
            realPriceUSatPerToken: this.shouldIgnore(chainIdentifier, token) ? null : swapPriceUSatPerToken,
            swapPriceUSatPerToken
        };
    }

    /**
     * Checks whether the swap amounts are valid given the current market rate for a given pair
     *
     * @param chainIdentifier
     * @param amountSats Amount of sats (BTC) to be paid to the swap
     * @param satsBaseFee Base fee in sats (BTC) as reported by the intermediary
     * @param feePPM PPM fee rate as reported by the intermediary
     * @param receiveToken Amount of token to be received from the swap
     * @param token
     * @param abortSignal
     * @param preFetchedPrice Already pre-fetched price
     */
    public async isValidAmountReceive<C extends ChainIds<T>>(
        chainIdentifier: C,
        amountSats: bigint,
        satsBaseFee: bigint,
        feePPM: bigint,
        receiveToken: bigint,
        token: string,
        abortSignal?: AbortSignal,
        preFetchedPrice?: bigint
    ): Promise<PriceInfoType> {
        const totalSats = (amountSats * (1000000n - feePPM) / 1000000n)
            - satsBaseFee;
        const totalUSats = totalSats * 1000000n;
        const swapPriceUSatPerToken = totalUSats * (10n ** BigInt(this.getDecimals(chainIdentifier, token))) / receiveToken;

        if(this.shouldIgnore(chainIdentifier, token)) return {
            isValid: true,
            differencePPM: 0n,
            satsBaseFee,
            feePPM,
            realPriceUSatPerToken: null,
            swapPriceUSatPerToken
        };

        const calculatedAmtInToken = await this.getFromBtcSwapAmount(chainIdentifier, totalSats, token, abortSignal, preFetchedPrice);
        const realPriceUSatPerToken = totalUSats * (10n ** BigInt(this.getDecimals(chainIdentifier, token))) / calculatedAmtInToken;

        const difference = calculatedAmtInToken - receiveToken; //Will be >0 if we receive less than we should've
        const differencePPM = difference * 100000n / calculatedAmtInToken;

        return {
            isValid: differencePPM <= this.maxAllowedFeeDifferencePPM,
            differencePPM,
            satsBaseFee,
            feePPM,
            realPriceUSatPerToken,
            swapPriceUSatPerToken
        };
    }

    public preFetchPrice<C extends ChainIds<T>>(chainIdentifier: C, token: string, abortSignal?: AbortSignal): Promise<bigint> {
        return this.getPrice(chainIdentifier, token, abortSignal);
    }

    public preFetchUsdPrice(abortSignal?: AbortSignal): Promise<number> {
        return this.getUsdPrice(abortSignal);
    }

    /**
     * Returns amount of {toToken} that are equivalent to {fromAmount} satoshis
     *
     * @param chainIdentifier
     * @param fromAmount        Amount of satoshis
     * @param toToken           Token
     * @param abortSignal
     * @param preFetchedPrice
     * @throws {Error} when token is not found
     */
    public async getFromBtcSwapAmount<C extends ChainIds<T>>(
        chainIdentifier: C,
        fromAmount: bigint,
        toToken: string,
        abortSignal?: AbortSignal,
        preFetchedPrice?: bigint
    ): Promise<bigint> {
        if(this.getDecimals(chainIdentifier, toToken.toString())==null) throw new Error("Token not found!");

        const price = preFetchedPrice || await this.getPrice(chainIdentifier, toToken, abortSignal);

        return fromAmount
            * (10n ** BigInt(this.getDecimals(chainIdentifier, toToken.toString())))
            * (1000000n) //To usat
            / (price);
    }

    /**
     * Returns amount of satoshis that are equivalent to {fromAmount} of {fromToken}
     *
     * @param chainIdentifier
     * @param fromAmount Amount of the token
     * @param fromToken Token
     * @param abortSignal
     * @param preFetchedPrice Pre-fetched swap price if available
     * @throws {Error} when token is not found
     */
    public async getToBtcSwapAmount<C extends ChainIds<T>>(
        chainIdentifier: C,
        fromAmount: bigint,
        fromToken: string,
        abortSignal?: AbortSignal,
        preFetchedPrice?: bigint
    ): Promise<bigint> {
        if(this.getDecimals(chainIdentifier, fromToken.toString())==null) throw new Error("Token not found");

        const price = preFetchedPrice || await this.getPrice(chainIdentifier, fromToken, abortSignal);

        return fromAmount
            * price
            / 1000000n
            / (10n ** BigInt(this.getDecimals(chainIdentifier, fromToken.toString())));
    }

    /**
     * Returns whether the token should be ignored and pricing for it not calculated
     * @param chainIdentifier
     * @param tokenAddress
     * @throws {Error} if token is not found
     */
    public shouldIgnore<C extends ChainIds<T>>(chainIdentifier: C, tokenAddress: string): boolean {
        const coin = this.getDecimals(chainIdentifier, tokenAddress.toString());
        if(coin==null) throw new Error("Token not found");
        return coin===-1;
    }

    public async getBtcUsdValue(
        btcSats: bigint,
        abortSignal?: AbortSignal,
        preFetchedPrice?: number
    ): Promise<number> {
        return Number(btcSats)*(preFetchedPrice || await this.getUsdPrice(abortSignal));
    }

    public async getTokenUsdValue<C extends ChainIds<T>>(
        chainId: C,
        tokenAmount: bigint,
        token: string,
        abortSignal?: AbortSignal,
        preFetchedPrice?: number
    ): Promise<number> {
        const [btcAmount, usdPrice] = await Promise.all([
            this.getToBtcSwapAmount(chainId, tokenAmount, token, abortSignal),
            preFetchedPrice==null ? this.preFetchUsdPrice(abortSignal) : Promise.resolve(preFetchedPrice)
        ]);
        return Number(btcAmount)*usdPrice;
    }

    public getUsdValue<C extends ChainIds<T>>(
        amount: bigint,
        token: Token<C>,
        abortSignal?: AbortSignal,
        preFetchedUsdPrice?: number
    ): Promise<number> {
        if(token.chain==="BTC") {
            return this.getBtcUsdValue(amount, abortSignal, preFetchedUsdPrice);
        } else {
            return this.getTokenUsdValue(token.chainId, amount, token.address, abortSignal, preFetchedUsdPrice);
        }
    }

}
