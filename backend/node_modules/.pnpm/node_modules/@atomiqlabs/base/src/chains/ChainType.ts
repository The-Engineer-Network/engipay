import {SwapData} from "../swaps/SwapData";
import {ChainEvents} from "../events/ChainEvents";
import {SwapContract} from "../swaps/SwapContract";
import {BtcRelay} from "../btcrelay/BtcRelay";
import {AbstractSigner, ChainInterface} from "./ChainInterface";
import {SpvVaultData} from "../spv_swap/SpvVaultData";
import {SpvVaultContract} from "../spv_swap/SpvVaultContract";
import {SpvWithdrawalTransactionData} from "../spv_swap/SpvWithdrawalTransactionData";

export type ChainType<
    ChainId extends string = string,
    PreFetchData = any,
    PreFetchVerification = any,
    TXType = any,
    Signer extends AbstractSigner = AbstractSigner,
    NativeSigner = any,
    T extends SwapData = SwapData,
    C extends SwapContract<T, TXType, PreFetchData, PreFetchVerification, Signer, ChainId> = SwapContract<T, TXType, PreFetchData, PreFetchVerification, Signer, ChainId>,
    I extends ChainInterface<TXType, Signer, ChainId, NativeSigner> = ChainInterface<TXType, Signer, ChainId, NativeSigner>,
    E extends ChainEvents<T> = ChainEvents<T>,
    B extends BtcRelay<any, TXType, any, Signer> = BtcRelay<any, TXType, any, Signer>,
    SpvData extends SpvVaultData = SpvVaultData,
    SpvWithdrawalData extends SpvWithdrawalTransactionData = SpvWithdrawalTransactionData,
    SpvContract extends SpvVaultContract<TXType, Signer, ChainId, SpvData, SpvWithdrawalData> = SpvVaultContract<TXType, Signer, ChainId, SpvData, SpvWithdrawalData>
> = {
    ChainId: ChainId,
    PreFetchData: PreFetchData,
    PreFetchVerification: PreFetchVerification,
    TX: TXType,
    Signer: Signer,
    ChainInterface: I,
    Data: T,
    Contract: C,
    Events: E,
    BtcRelay: B,
    SpvVaultData: SpvData,
    SpvVaultContract: SpvContract,
    SpvVaultWithdrawalData: SpvWithdrawalData,
    NativeSigner: NativeSigner
}
