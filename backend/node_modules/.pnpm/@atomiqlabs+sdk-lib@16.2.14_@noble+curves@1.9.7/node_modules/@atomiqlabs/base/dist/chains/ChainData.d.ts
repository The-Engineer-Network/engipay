import { ChainType } from "./ChainType";
import { BitcoinRpc } from "../btc/rpc/BitcoinRpc";
import { BitcoinNetwork } from "../btc/BitcoinNetwork";
import { IStorageManager } from "../storage/IStorageManager";
import { StorageObject } from "../storage/StorageObject";
export type BaseTokenType<T extends string = string> = {
    [ticker in T]: {
        address: string;
        decimals: number;
        displayDecimals?: number;
    };
};
export type ChainData<T extends ChainType> = {
    chainId: ChainType["ChainId"];
    chainInterface: T["ChainInterface"];
    btcRelay: T["BtcRelay"];
    chainEvents: T["Events"];
    swapContract: T["Contract"];
    swapDataConstructor: new (data: any) => T["Data"];
    spvVaultContract: T["SpvVaultContract"];
    spvVaultDataConstructor: new (data: any) => T["SpvVaultData"];
    spvVaultWithdrawalDataConstructor: new (data: any) => T["SpvVaultWithdrawalData"];
};
export type ChainInitializerFn<O, C extends ChainType> = (options: O, bitcoinRpc: BitcoinRpc<any>, network: BitcoinNetwork, storageCtor: <T extends StorageObject>(name: string) => IStorageManager<T>) => ChainData<C>;
export type ChainInitializer<O, C extends ChainType, T extends BaseTokenType> = {
    chainId: C["ChainId"];
    chainType: C;
    initializer: ChainInitializerFn<O, C>;
    tokens: T;
    options: O;
};
