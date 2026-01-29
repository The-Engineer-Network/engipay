import {SignatureVerificationError, SwapDataVerificationError} from "@atomiqlabs/base";
import {toHex, tryWithRetries} from "../../../utils/Utils";
import {StarknetSwapModule} from "../StarknetSwapModule";
import {StarknetSwapData} from "../StarknetSwapData";
import {StarknetAction} from "../../chain/StarknetAction";
import {IHandler} from "../handlers/IHandler";
import {BigNumberish} from "starknet";
import {StarknetTx} from "../../chain/modules/StarknetTransactions";
import {StarknetSigner} from "../../wallet/StarknetSigner";
import {StarknetFees, StarknetGas, starknetGasAdd} from "../../chain/modules/StarknetFees";

const Refund = [
    { name: 'Swap hash', type: 'felt' },
    { name: 'Timeout', type: 'timestamp' }
];

export class StarknetSwapRefund extends StarknetSwapModule {

    private static readonly GasCosts = {
        REFUND: {l1DataGas: 750, l2Gas: 4_000_000, l1Gas: 0},
        REFUND_PAY_OUT: {l1DataGas: 900, l2Gas: 6_000_000, l1Gas: 0}
    };

    /**
     * Action for generic Refund instruction
     *
     * @param signer
     * @param swapData
     * @param witness
     * @param handlerGas
     * @constructor
     * @private
     */
    private Refund(
        signer: string,
        swapData: StarknetSwapData,
        witness: BigNumberish[],
        handlerGas?: StarknetGas
    ): StarknetAction {
        return new StarknetAction(signer, this.root,
            this.swapContract.populateTransaction.refund(swapData.toEscrowStruct(), witness),
            starknetGasAdd(swapData.payIn ? StarknetSwapRefund.GasCosts.REFUND_PAY_OUT : StarknetSwapRefund.GasCosts.REFUND, handlerGas)
        );
    }

    /**
     * Action for cooperative refunding with signature
     *
     * @param sender
     * @param swapData
     * @param timeout
     * @param signature
     * @constructor
     * @private
     */
    private RefundWithSignature(
        sender: string,
        swapData: StarknetSwapData,
        timeout: string,
        signature: BigNumberish[]
    ): StarknetAction {
        return new StarknetAction(sender, this.root,
            this.swapContract.populateTransaction.cooperative_refund(swapData.toEscrowStruct(), signature, BigInt(timeout)),
            swapData.payIn ? StarknetSwapRefund.GasCosts.REFUND_PAY_OUT : StarknetSwapRefund.GasCosts.REFUND
        );
    }

    public async signSwapRefund(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        authorizationTimeout: number
    ): Promise<{ prefix: string; timeout: string; signature: string }> {
        const authPrefix = "refund";
        const authTimeout = Math.floor(Date.now()/1000)+authorizationTimeout;

        const signature = await this.root.Signatures.signTypedMessage(signer, Refund, "Refund", {
            "Swap hash": "0x"+swapData.getEscrowHash(),
            "Timeout": toHex(authTimeout)
        });

        return {
            prefix: authPrefix,
            timeout: authTimeout.toString(10),
            signature: signature
        };
    }

    public async isSignatureValid(
        swapData: StarknetSwapData,
        timeout: string,
        prefix: string,
        signature: string
    ): Promise<null> {
        if(prefix!=="refund") throw new SignatureVerificationError("Invalid prefix");

        const expiryTimestamp = BigInt(timeout);
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));

        const isExpired = (expiryTimestamp - currentTimestamp) < BigInt(this.contract.authGracePeriod);
        if(isExpired) throw new SignatureVerificationError("Authorization expired!");

        const valid = await this.root.Signatures.isValidSignature(signature, swapData.claimer, Refund, "Refund", {
            "Swap hash": "0x"+swapData.getEscrowHash(),
            "Timeout": toHex(expiryTimestamp)
        });

        if(!valid) {
            throw new SignatureVerificationError("Invalid signature!");
        }

        return null;
    }

    /**
     * Creates transactions required for refunding timed out swap
     *
     * @param signer
     * @param swapData swap data to refund
     * @param check whether to check if swap is already expired and refundable
     * @param feeRate fee rate to be used for the transactions
     * @param witnessData
     */
    public async txsRefund<T>(
        signer: string,
        swapData: StarknetSwapData,
        check?: boolean,
        feeRate?: string,
        witnessData?: T
    ): Promise<StarknetTx[]> {
        const refundHandler: IHandler<any, T> = this.contract.refundHandlersByAddress[swapData.refundHandler.toLowerCase()];
        if(refundHandler==null) throw new Error("Invalid refund handler");

        if(check && !await tryWithRetries(() => this.contract.isRequestRefundable(swapData.offerer.toString(), swapData), this.retryPolicy)) {
            throw new SwapDataVerificationError("Not refundable yet!");
        }

        feeRate ??= await this.root.Fees.getFeeRate();

        const {initialTxns, witness} = await refundHandler.getWitness(signer, swapData, witnessData, feeRate);

        const action = this.Refund(signer, swapData, witness, refundHandler.getGas(swapData));
        await action.addToTxs(initialTxns, feeRate);

        this.logger.debug("txsRefund(): creating refund transaction, swap: "+swapData.getClaimHash());

        return initialTxns;
    }

    /**
     * Creates transactions required for refunding the swap with authorization signature, also unwraps WSOL to SOL
     *
     * @param signer
     * @param swapData swap data to refund
     * @param timeout signature timeout
     * @param prefix signature prefix of the counterparty
     * @param signature signature of the counterparty
     * @param check whether to check if swap is committed before attempting refund
     * @param feeRate fee rate to be used for the transactions
     */
    public async txsRefundWithAuthorization(
        signer: string,
        swapData: StarknetSwapData,
        timeout: string,
        prefix: string,
        signature: string,
        check?: boolean,
        feeRate?: string
    ): Promise<StarknetTx[]> {
        if(check && !await tryWithRetries(() => this.contract.isCommited(swapData), this.retryPolicy)) {
            throw new SwapDataVerificationError("Not correctly committed");
        }
        await tryWithRetries(
            () => this.isSignatureValid(swapData, timeout, prefix, signature),
            this.retryPolicy,
            (e) => e instanceof SignatureVerificationError
        );

        const action = this.RefundWithSignature(signer, swapData, timeout, JSON.parse(signature));

        feeRate ??= await this.root.Fees.getFeeRate();

        this.logger.debug("txsRefundWithAuthorization(): creating refund transaction, swap: "+swapData.getClaimHash()+
            " auth expiry: "+timeout+" signature: "+signature);

        return [await action.tx(feeRate)];
    }

    /**
     * Get the estimated solana transaction fee of the refund transaction, in the worst case scenario in case where the
     *  ATA needs to be initialized again (i.e. adding the ATA rent exempt lamports to the fee)
     */
    async getRefundFee(swapData: StarknetSwapData, feeRate?: string): Promise<bigint> {
        feeRate ??= await this.root.Fees.getFeeRate();
        return StarknetFees.getGasFee(swapData.payIn ? StarknetSwapRefund.GasCosts.REFUND_PAY_OUT : StarknetSwapRefund.GasCosts.REFUND, feeRate);
    }

}