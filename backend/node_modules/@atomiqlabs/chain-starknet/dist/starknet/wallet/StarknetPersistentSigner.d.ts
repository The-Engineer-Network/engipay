import { StarknetSigner } from "./StarknetSigner";
import { StarknetTx } from "../chain/modules/StarknetTransactions";
import { StarknetChainInterface } from "../chain/StarknetChainInterface";
import { Account } from "starknet";
export type StarknetPersistentSignerConfig = {
    waitBeforeBump?: number;
    minFeeIncreaseAbsolute?: bigint;
    minFeeIncreasePpm?: bigint;
    minTipIncreaseAbsolute?: bigint;
    minTipIncreasePpm?: bigint;
};
export declare class StarknetPersistentSigner extends StarknetSigner {
    private pendingTxs;
    private confirmedNonce;
    private pendingNonce;
    private feeBumper;
    private stopped;
    private readonly directory;
    private readonly config;
    private readonly chainInterface;
    private readonly logger;
    constructor(account: Account, chainInterface: StarknetChainInterface, directory: string, config?: StarknetPersistentSignerConfig);
    private load;
    private priorSavePromise;
    private saveCount;
    private save;
    private checkPastTransactions;
    private startFeeBumper;
    private syncNonceFromChain;
    init(): Promise<void>;
    stop(): Promise<void>;
    private readonly sendTransactionQueue;
    sendTransaction(transaction: StarknetTx, onBeforePublish?: (txId: string, rawTx: string) => Promise<void>): Promise<string>;
}
