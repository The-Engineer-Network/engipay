import { BtcStoredHeader } from "../types/BtcStoredHeader";
import { BtcBlock } from "../types/BtcBlock";
export interface RelaySynchronizer<V extends BtcStoredHeader<any>, T, B extends BtcBlock> {
    syncToLatestTxs(signer: string, feeRate?: string): Promise<{
        txs: T[];
        targetCommitedHeader: V;
        latestBlockHeader: B;
        computedHeaderMap: {
            [blockheight: number]: V;
        };
        blockHeaderMap: {
            [blockheight: number]: B;
        };
        btcRelayTipCommitedHeader: V;
        btcRelayTipBlockHeader: B;
        startForkId?: number;
    }>;
}
