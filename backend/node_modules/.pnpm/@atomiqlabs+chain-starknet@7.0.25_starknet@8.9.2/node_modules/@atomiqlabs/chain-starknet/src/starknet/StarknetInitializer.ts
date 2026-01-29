import {constants, Provider, WebSocketChannel} from "starknet";
import {StarknetFees} from "./chain/modules/StarknetFees";
import {StarknetChainInterface, StarknetConfig, StarknetRetryPolicy} from "./chain/StarknetChainInterface";
import {StarknetBtcRelay} from "./btcrelay/StarknetBtcRelay";
import {StarknetSwapContract} from "./swaps/StarknetSwapContract";
import {StarknetChainEventsBrowser} from "./events/StarknetChainEventsBrowser";
import {BaseTokenType, BitcoinNetwork, BitcoinRpc, ChainData, ChainInitializer, ChainSwapType} from "@atomiqlabs/base";
import {StarknetChainType} from "./StarknetChainType";
import {StarknetSwapData} from "./swaps/StarknetSwapData";
import {StarknetSpvVaultContract} from "./spv_swap/StarknetSpvVaultContract";
import {StarknetSpvVaultData} from "./spv_swap/StarknetSpvVaultData";
import {StarknetSpvWithdrawalData} from "./spv_swap/StarknetSpvWithdrawalData";
import {RpcProviderWithRetries} from "./provider/RpcProviderWithRetries";
import {WebSocketChannelWithRetries} from "./provider/WebSocketChannelWithRetries";

export type StarknetAssetsType = BaseTokenType<"ETH" | "STRK" | "WBTC" | "TBTC" | "USDC" | "USDT" | "_TESTNET_WBTC_VESU">;
export const StarknetAssets: StarknetAssetsType = {
    ETH: {
        address: "0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7",
        decimals: 18,
        displayDecimals: 9
    },
    STRK: {
        address: "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
        decimals: 18,
        displayDecimals: 9
    },
    WBTC: {
        address: "0x03fe2b97c1fd336e750087d68b9b867997fd64a2661ff3ca5a7c771641e8e7ac",
        decimals: 8
    },
    TBTC: {
        address: "0x04daa17763b286d1e59b97c283c0b8c949994c361e426a28f743c67bdfe9a32f",
        decimals: 18,
        displayDecimals: 8
    },
    USDC: {
        address: "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb",
        decimals: 6
    },
    USDT: {
        address: "0x068f5c6a61780768455de69077e07e89787839bf8166decfbf92b645209c0fb8",
        decimals: 6
    },
    _TESTNET_WBTC_VESU: {
        address: "0x04861ba938aed21f2cd7740acd3765ac4d2974783a3218367233de0153490cb6",
        decimals: 8
    }
} as const;

export type StarknetOptions = {
    rpcUrl: string | Provider,
    wsUrl?: string | WebSocketChannel,
    retryPolicy?: StarknetRetryPolicy,
    chainId?: constants.StarknetChainId,

    swapContract?: string,
    btcRelayContract?: string,
    spvVaultContract?: string,
    handlerContracts?: {
        refund?: {
            timelock?: string
        },
        claim?: {
            [type in ChainSwapType]?: string
        }
    }

    fees?: StarknetFees,

    starknetConfig?: StarknetConfig
}

export function initializeStarknet(
    options: StarknetOptions,
    bitcoinRpc: BitcoinRpc<any>,
    network: BitcoinNetwork
): ChainData<StarknetChainType> {
    const provider = typeof(options.rpcUrl)==="string" ?
        new RpcProviderWithRetries({nodeUrl: options.rpcUrl}) :
        options.rpcUrl;
    let wsChannel: WebSocketChannel;
    if(options.wsUrl!=null) wsChannel = typeof(options.wsUrl)==="string" ?
        new WebSocketChannelWithRetries({nodeUrl: options.wsUrl, reconnectOptions: {delay: 2000, retries: Infinity}}) :
        options.wsUrl;

    const Fees = options.fees ?? new StarknetFees(provider);

    const chainId = options.chainId ??
        (network===BitcoinNetwork.MAINNET ? constants.StarknetChainId.SN_MAIN : constants.StarknetChainId.SN_SEPOLIA);

    const chainInterface = new StarknetChainInterface(chainId, provider, wsChannel, options.retryPolicy, Fees, options.starknetConfig);

    const btcRelay = new StarknetBtcRelay(
        chainInterface, bitcoinRpc, network, options.btcRelayContract
    );

    const swapContract = new StarknetSwapContract(
        chainInterface, btcRelay, options.swapContract, options.handlerContracts
    );

    const spvVaultContract = new StarknetSpvVaultContract(
        chainInterface, btcRelay, bitcoinRpc, options.spvVaultContract
    )

    const chainEvents = new StarknetChainEventsBrowser(chainInterface, swapContract, spvVaultContract);

    return {
        chainId: "STARKNET",
        btcRelay,
        chainInterface,
        swapContract,
        chainEvents,
        swapDataConstructor: StarknetSwapData,
        spvVaultContract,
        spvVaultDataConstructor: StarknetSpvVaultData,
        spvVaultWithdrawalDataConstructor: StarknetSpvWithdrawalData
    }
};

export type StarknetInitializerType = ChainInitializer<StarknetOptions, StarknetChainType, StarknetAssetsType>;
export const StarknetInitializer: StarknetInitializerType = {
    chainId: "STARKNET",
    chainType: null as StarknetChainType,
    initializer: initializeStarknet,
    tokens: StarknetAssets,
    options: null as StarknetOptions
} as const;
