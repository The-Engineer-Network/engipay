import { constants, Provider, WebSocketChannel } from "starknet";
import { StarknetFees } from "./chain/modules/StarknetFees";
import { StarknetConfig, StarknetRetryPolicy } from "./chain/StarknetChainInterface";
import { BaseTokenType, BitcoinNetwork, BitcoinRpc, ChainData, ChainInitializer, ChainSwapType } from "@atomiqlabs/base";
import { StarknetChainType } from "./StarknetChainType";
export type StarknetAssetsType = BaseTokenType<"ETH" | "STRK" | "WBTC" | "TBTC" | "USDC" | "USDT" | "_TESTNET_WBTC_VESU">;
export declare const StarknetAssets: StarknetAssetsType;
export type StarknetOptions = {
    rpcUrl: string | Provider;
    wsUrl?: string | WebSocketChannel;
    retryPolicy?: StarknetRetryPolicy;
    chainId?: constants.StarknetChainId;
    swapContract?: string;
    btcRelayContract?: string;
    spvVaultContract?: string;
    handlerContracts?: {
        refund?: {
            timelock?: string;
        };
        claim?: {
            [type in ChainSwapType]?: string;
        };
    };
    fees?: StarknetFees;
    starknetConfig?: StarknetConfig;
};
export declare function initializeStarknet(options: StarknetOptions, bitcoinRpc: BitcoinRpc<any>, network: BitcoinNetwork): ChainData<StarknetChainType>;
export type StarknetInitializerType = ChainInitializer<StarknetOptions, StarknetChainType, StarknetAssetsType>;
export declare const StarknetInitializer: StarknetInitializerType;
