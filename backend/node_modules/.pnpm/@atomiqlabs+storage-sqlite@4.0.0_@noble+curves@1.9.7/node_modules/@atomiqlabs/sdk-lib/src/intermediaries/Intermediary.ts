import {SwapType} from "../swaps/enums/SwapType";
import {SwapHandlerInfoType} from "./IntermediaryDiscovery";
import {ChainSwapType, SwapContract} from "@atomiqlabs/base";
import {LNNodeLiquidity} from "../btc/LightningNetworkApi";
import {tryWithRetries} from "../utils/Utils";

export type ServicesType = {
    [key in SwapType]?: SwapHandlerInfoType
};

export type SingleChainReputationType = {
    [token: string]: {
        [key in ChainSwapType]: {
            successVolume: bigint,
            successCount: bigint,
            failVolume: bigint,
            failCount: bigint,
            coopCloseVolume: bigint,
            coopCloseCount: bigint,
        }
    }
};

export type SCLiquidity = {
    [token: string]: bigint
};

export class Intermediary {

    readonly url: string;
    readonly addresses: {[chainIdentifier: string]: string};
    readonly services: ServicesType;
    readonly swapBounds: {
        [swapType in SwapType]?: {
            [chainIdentifier: string]: {
                [tokenAddress: string]: {
                    input: {
                        min: bigint,
                        max: bigint
                    },
                    output: {
                        min: bigint,
                        max: bigint
                    }
                }
            }
        }
    }
    reputation: { [chainIdentifier: string]: SingleChainReputationType } = {};
    liquidity: { [chainIdentifier: string]: SCLiquidity } = {};
    lnData: LNNodeLiquidity;

    constructor(
        url: string,
        addresses: {[chainIdentifier: string]: string},
        services: ServicesType,
        reputation: { [chainIdentifier: string]: SingleChainReputationType } = {}
    ) {
        this.url = url;
        this.addresses = addresses;
        this.services = services;
        this.reputation = reputation;

        this.swapBounds = {};
        for(let _swapType in this.services) {
            const swapType: SwapType = parseInt(_swapType);
            const serviceInfo: SwapHandlerInfoType = this.services[_swapType];
            const btcBounds = {min: BigInt(serviceInfo.min), max: BigInt(serviceInfo.max)};
            const isSend = swapType===SwapType.TO_BTC || swapType===SwapType.TO_BTCLN;
            this.swapBounds[swapType] = {};
            for(let chainIdentifier in serviceInfo.chainTokens) {
                this.swapBounds[swapType][chainIdentifier] = {};
                for(let tokenAddress of serviceInfo.chainTokens[chainIdentifier]) {
                    this.swapBounds[swapType][chainIdentifier][tokenAddress] = {
                        input: isSend ? {min: null, max: null} : btcBounds,
                        output: !isSend ? {min: null, max: null} : btcBounds,
                    };
                }
            }
        }
    }

    getSwapLimits(swapType: SwapType, chainId: string, tokenAddress: string): {input: {min: bigint, max: bigint}, output: {min: bigint, max: bigint}} {
        return this.swapBounds[swapType]?.[chainId]?.[tokenAddress];
    }

    /**
     * Returns tokens supported by the intermediary, optionally constrained to the specific swap types
     *
     * @param chainIdentifier
     * @param swapTypesArr
     * @private
     */
    private getSupportedTokens(chainIdentifier: string, swapTypesArr: SwapType[] = [
        SwapType.TO_BTC,
        SwapType.TO_BTCLN,
        SwapType.FROM_BTC,
        SwapType.FROM_BTCLN,
        SwapType.SPV_VAULT_FROM_BTC,
        SwapType.FROM_BTCLN_AUTO
    ]): Set<string> {
        const swapTypes = new Set(swapTypesArr);
        let tokens: Set<string> = new Set<string>();
        swapTypes.forEach((swapType) => {
            if(
                this.services[swapType]!=null &&
                this.services[swapType].chainTokens!=null &&
                this.services[swapType].chainTokens[chainIdentifier]!=null
            ) this.services[swapType].chainTokens[chainIdentifier].forEach(token => tokens.add(token));
        });
        return tokens;
    }

    /**
     * Fetches, returns and saves the reputation of the intermediary, either for all or just for a single token
     *
     * @param chainIdentifier
     * @param swapContract
     * @param tokens
     * @param abortSignal
     */
    async getReputation(
        chainIdentifier: string,
        swapContract: SwapContract<any>,
        tokens?: string[],
        abortSignal?: AbortSignal
    ): Promise<SingleChainReputationType> {
        const checkReputationTokens: Set<string> = tokens==null ?
            this.getSupportedTokens(chainIdentifier, [SwapType.TO_BTC, SwapType.TO_BTCLN]) :
            new Set<string>(tokens);

        const promises: Promise<void>[] = [];
        const reputation: SingleChainReputationType = {};
        for(let token of checkReputationTokens) {
            promises.push(
                tryWithRetries(() =>
                    swapContract.getIntermediaryReputation(this.getAddress(chainIdentifier), token),
                    null, null, abortSignal
                ).then(result => {
                    reputation[token] = result;
                })
            );
        }
        await Promise.all(promises);

        this.reputation ??= {};
        this.reputation[chainIdentifier] ??= {};
        for(let key in reputation) {
            this.reputation[chainIdentifier][key] = reputation[key];
        }

        return reputation;
    }

    /**
     * Fetches, returns and saves the liquidity of the intermediaryfor a specific token
     *
     * @param chainIdentifier
     * @param swapContract
     * @param token
     * @param abortSignal
     */
    async getLiquidity(
        chainIdentifier: string,
        swapContract: SwapContract<any>,
        token: string,
        abortSignal?: AbortSignal
    ): Promise<bigint> {
        const result = await tryWithRetries(() =>
            swapContract.getBalance(this.getAddress(chainIdentifier), token, true),
            null, null, abortSignal
        );

        this.liquidity ??= {};
        this.liquidity[chainIdentifier] ??= {};
        this.liquidity[chainIdentifier][token] = result;

        return result;
    }

    supportsChain(chainIdentifier: string): boolean {
        if(this.addresses[chainIdentifier]==null) return false;
        return this.getSupportedTokens(chainIdentifier).size!==0;
    }

    getAddress(chainIdentifier: string) {
        return this.addresses[chainIdentifier];
    }

}
