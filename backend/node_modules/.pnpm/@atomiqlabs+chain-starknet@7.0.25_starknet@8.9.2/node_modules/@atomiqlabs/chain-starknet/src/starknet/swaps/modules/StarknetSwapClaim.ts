import {ChainSwapType, RelaySynchronizer, SwapDataVerificationError} from "@atomiqlabs/base";
import {toHex} from "../../../utils/Utils";
import {StarknetSwapModule} from "../StarknetSwapModule";
import {StarknetSwapData} from "../StarknetSwapData";
import {StarknetAction} from "../../chain/StarknetAction";
import {BigNumberish} from "starknet";
import {IClaimHandler} from "../handlers/claim/ClaimHandlers";
import {StarknetTx} from "../../chain/modules/StarknetTransactions";
import {StarknetFees, StarknetGas, starknetGasAdd} from "../../chain/modules/StarknetFees";
import {StarknetBtcStoredHeader} from "../../btcrelay/headers/StarknetBtcStoredHeader";
import {BitcoinOutputWitnessData} from "../handlers/claim/btc/BitcoinOutputClaimHandler";
import {BitcoinWitnessData} from "../handlers/claim/btc/IBitcoinClaimHandler";
import {Buffer} from "buffer";

export class StarknetSwapClaim extends StarknetSwapModule {

    private static readonly GasCosts = {
        CLAIM: {l1DataGas: 750, l2Gas: 4_000_000, l1Gas: 0},
        CLAIM_PAY_OUT: {l1DataGas: 900, l2Gas: 6_000_000, l1Gas: 0}
    };

    /**
     * Claim action which uses the provided witness for claiming the swap
     *
     * @param signer
     * @param swapData
     * @param witness
     * @param claimHandlerGas
     * @constructor
     * @private
     */
    private Claim(
        signer: string,
        swapData: StarknetSwapData,
        witness: BigNumberish[],
        claimHandlerGas?: StarknetGas
    ): StarknetAction {
        return new StarknetAction(signer, this.root,
            this.swapContract.populateTransaction.claim(swapData.toEscrowStruct(), witness),
            starknetGasAdd(swapData.payOut ? StarknetSwapClaim.GasCosts.CLAIM_PAY_OUT : StarknetSwapClaim.GasCosts.CLAIM, claimHandlerGas)
        );
    }

    /**
     * Creates transactions claiming the swap using a secret (for HTLC swaps)
     *
     * @param signer
     * @param swapData swap to claim
     * @param secret hex encoded secret pre-image to the HTLC hash
     * @param checkExpiry whether to check if the swap is already expired (trying to claim an expired swap with a secret
     *  is dangerous because we might end up revealing the secret to the counterparty without being able to claim the swap)
     * @param feeRate fee rate to use for the transaction
     */
    async txsClaimWithSecret(
        signer: string,
        swapData: StarknetSwapData,
        secret: string,
        checkExpiry?: boolean,
        feeRate?: string
    ): Promise<StarknetTx[]> {
        //We need to be sure that this transaction confirms in time, otherwise we reveal the secret to the counterparty
        // and won't claim the funds
        if(checkExpiry && await this.contract.isExpired(swapData.claimer.toString(), swapData)) {
            throw new SwapDataVerificationError("Not enough time to reliably pay the invoice");
        }

        const claimHandler: IClaimHandler<Buffer, string> = this.contract.claimHandlersByAddress[toHex(swapData.claimHandler)];
        if(claimHandler==null) throw new SwapDataVerificationError("Unknown claim handler!");
        if(claimHandler.getType()!==ChainSwapType.HTLC) throw new SwapDataVerificationError("Invalid claim handler!");

        feeRate ??= await this.root.Fees.getFeeRate();

        const {initialTxns, witness} = await claimHandler.getWitness(signer, swapData, secret, feeRate);
        const action = this.Claim(signer, swapData, witness, claimHandler.getGas(swapData));
        await action.addToTxs(initialTxns, feeRate);

        this.logger.debug("txsClaimWithSecret(): creating claim transaction, swap: "+swapData.getClaimHash()+" witness: ", witness.map(toHex));

        return initialTxns;
    }

    /**
     * Creates transaction claiming the swap using a confirmed transaction data (for BTC on-chain swaps)
     *
     * @param signer
     * @param swapData swap to claim
     * @param tx bitcoin transaction that satisfies the swap condition
     * @param requiredConfirmations
     * @param vout vout of the bitcoin transaction that satisfies the swap condition
     * @param commitedHeader commited header data from btc relay (fetched internally if null)
     * @param synchronizer optional synchronizer to use in case we need to sync up the btc relay ourselves
     * @param feeRate fee rate to be used for the transactions
     */
    async txsClaimWithTxData(
        signer: string,
        swapData: StarknetSwapData,
        tx: { blockhash: string, confirmations: number, txid: string, hex: string, height: number },
        requiredConfirmations: number,
        vout: number,
        commitedHeader?: StarknetBtcStoredHeader,
        synchronizer?: RelaySynchronizer<StarknetBtcStoredHeader, StarknetTx, any>,
        feeRate?: string
    ): Promise<StarknetTx[] | null> {
        const claimHandler: IClaimHandler<any, BitcoinOutputWitnessData | BitcoinWitnessData> = this.contract.claimHandlersByAddress[toHex(swapData.claimHandler)];
        if(claimHandler==null) throw new SwapDataVerificationError("Unknown claim handler!");
        if(
            claimHandler.getType()!==ChainSwapType.CHAIN_NONCED &&
            claimHandler.getType()!==ChainSwapType.CHAIN_TXID &&
            claimHandler.getType()!==ChainSwapType.CHAIN
        ) throw new SwapDataVerificationError("Invalid claim handler!");

        feeRate ??= await this.root.Fees.getFeeRate();

        const {initialTxns, witness} = await claimHandler.getWitness(signer, swapData, {
            tx,
            vout,
            requiredConfirmations,
            commitedHeader,
            btcRelay: this.contract.btcRelay,
            synchronizer,
        }, feeRate);
        const action = this.Claim(signer, swapData, witness, claimHandler.getGas(swapData));
        await action.addToTxs(initialTxns, feeRate);

        return initialTxns;
    }

    /**
     * Get the estimated starknet transaction fee of the claim transaction
     */
    public async getClaimFee(swapData: StarknetSwapData, feeRate?: string): Promise<bigint> {
        feeRate ??= await this.root.Fees.getFeeRate();

        let gasRequired = swapData.payOut ? StarknetSwapClaim.GasCosts.CLAIM_PAY_OUT : StarknetSwapClaim.GasCosts.CLAIM;

        const claimHandler: IClaimHandler<any, any> = this.contract.claimHandlersByAddress[toHex(swapData.claimHandler)];
        if(claimHandler!=null) gasRequired = starknetGasAdd(gasRequired, claimHandler.getGas(swapData));

        return StarknetFees.getGasFee(gasRequired, feeRate);
    }

}