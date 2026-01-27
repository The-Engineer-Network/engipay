import {BtcStoredHeader} from "../types/BtcStoredHeader";
import {BtcBlock} from "../types/BtcBlock";


export interface RelaySynchronizer<V extends BtcStoredHeader<any>, T, B extends BtcBlock> {

    syncToLatestTxs(signer: string, feeRate?: string): Promise<{
        txs: T[], //Transactions required to synchronize the btc relay
        targetCommitedHeader: V, //Latest committed header after synchronization
        latestBlockHeader: B, //Latest block header after synchronization
        computedHeaderMap: {[blockheight: number]: V}, //Mapping of synchronized committed headers
        blockHeaderMap: {[blockheight: number]: B}, //Mapping of synchronized block headers
        btcRelayTipCommitedHeader: V, //Tip committed header of the btc relay before synchronization
        btcRelayTipBlockHeader: B, //Tip block header of the btc relay before synchronization
        startForkId?: number
    }>;

}