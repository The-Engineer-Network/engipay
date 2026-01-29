import {ChainType} from "@atomiqlabs/base";
import {StarknetTx} from "./chain/modules/StarknetTransactions";
import {StarknetSigner} from "./wallet/StarknetSigner";
import {StarknetSwapData} from "./swaps/StarknetSwapData";
import {StarknetSwapContract} from "./swaps/StarknetSwapContract";
import {StarknetChainEventsBrowser} from "./events/StarknetChainEventsBrowser";
import {StarknetBtcRelay} from "./btcrelay/StarknetBtcRelay";
import {StarknetPreFetchVerification} from "./swaps/modules/StarknetSwapInit";
import {StarknetChainInterface} from "./chain/StarknetChainInterface";
import {StarknetSpvVaultData} from "./spv_swap/StarknetSpvVaultData";
import {StarknetSpvWithdrawalData} from "./spv_swap/StarknetSpvWithdrawalData";
import {StarknetSpvVaultContract} from "./spv_swap/StarknetSpvVaultContract";
import {Account} from "starknet";

export type StarknetChainType = ChainType<
    "STARKNET",
    never,
    StarknetPreFetchVerification,
    StarknetTx,
    StarknetSigner,
    Account,
    StarknetSwapData,
    StarknetSwapContract,
    StarknetChainInterface,
    StarknetChainEventsBrowser,
    StarknetBtcRelay<any>,
    StarknetSpvVaultData,
    StarknetSpvWithdrawalData,
    StarknetSpvVaultContract
>;
