export type LNNodeLiquidity = {
    publicKey: string;
    capacity: bigint;
    numChannels: number;
};
export interface LightningNetworkApi {
    /**
     * Returns the lightning network's node liquidity as identified by an identity public key
     * @param pubkey
     */
    getLNNodeLiquidity(pubkey: string): Promise<LNNodeLiquidity>;
}
