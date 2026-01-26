import {SignatureVerificationError, SwapCommitStateType, SwapDataVerificationError} from "@atomiqlabs/base";
import {bufferToBytes31Span, toHex, tryWithRetries} from "../../../utils/Utils";
import {Buffer} from "buffer";
import {StarknetSwapData} from "../StarknetSwapData";
import {StarknetAction} from "../../chain/StarknetAction";
import {StarknetSwapModule} from "../StarknetSwapModule";
import {BigNumberish, cairo, BlockTag} from "starknet";
import {StarknetSigner} from "../../wallet/StarknetSigner";
import {StarknetFees} from "../../chain/modules/StarknetFees";
import {StarknetTx} from "../../chain/modules/StarknetTransactions";

export type StarknetPreFetchVerification = {
    pendingBlockTime?: number
};

const Initialize = [
    { name: 'Swap hash', type: 'felt' },
    { name: 'Offerer', type: 'ContractAddress'},
    { name: 'Claimer', type: 'ContractAddress'},
    { name: 'Token amount', type: 'TokenAmount'},
    { name: 'Pay in', type: 'bool'},
    { name: 'Pay out', type: 'bool'},
    { name: 'Tracking reputation', type: 'bool'},
    { name: 'Claim handler', type: 'ContractAddress'},
    { name: 'Claim data', type: 'felt'},
    { name: 'Refund handler', type: 'ContractAddress'},
    { name: 'Refund data', type: 'felt'},
    { name: 'Security deposit', type: 'TokenAmount'},
    { name: 'Claimer bounty', type: 'TokenAmount'},
    { name: 'Claim action hash', type: 'felt'},
    { name: 'Deadline', type: 'timestamp' }
];

export class StarknetSwapInit extends StarknetSwapModule {

    private static readonly GasCosts = {
        INIT: {l1DataGas: 750, l2Gas: 8_000_000, l1Gas: 0},
        INIT_PAY_IN: {l1DataGas: 500, l2Gas: 4_800_000, l1Gas: 0},
    };

    /**
     * bare Init action based on the data passed in swapData
     *
     * @param signer
     * @param swapData
     * @param timeout
     * @param signature
     * @private
     */
    private Init(signer: string, swapData: StarknetSwapData, timeout: bigint, signature: BigNumberish[]): StarknetAction {
        return new StarknetAction(
            signer,
            this.root,
            this.swapContract.populateTransaction.initialize(
                swapData.toEscrowStruct(),
                signature ?? [],
                timeout,
                swapData.extraData==null || swapData.extraData==="" ? [] : bufferToBytes31Span(Buffer.from(swapData.extraData, "hex")).map(toHex)
            ),
            swapData.payIn ? StarknetSwapInit.GasCosts.INIT_PAY_IN : StarknetSwapInit.GasCosts.INIT
        )
    }

    /**
     * Returns auth prefix to be used with a specific swap, payIn=true & payIn=false use different prefixes (these
     *  actually have no meaning for the smart contract/solana program in the Solana case)
     *
     * @param swapData
     * @private
     */
    private getAuthPrefix(swapData: StarknetSwapData): string {
        return swapData.isPayIn() ? "claim_initialize" : "initialize";
    }

    public async preFetchForInitSignatureVerification(): Promise<StarknetPreFetchVerification> {
        return {
            pendingBlockTime: await this.root.Blocks.getBlockTime(BlockTag.PRE_CONFIRMED)
        };
    }

    /**
     * Signs swap initialization authorization, using data from preFetchedBlockData if provided & still valid (subject
     *  to SIGNATURE_PREFETCH_DATA_VALIDITY)
     *
     * @param signer
     * @param swapData
     * @param authorizationTimeout
     * @public
     */
    public async signSwapInitialization(
        signer: StarknetSigner,
        swapData: StarknetSwapData,
        authorizationTimeout: number
    ): Promise<{prefix: string, timeout: string, signature: string}> {
        const authTimeout = Math.floor(Date.now()/1000)+authorizationTimeout;

        const signature = await this.root.Signatures.signTypedMessage(signer, Initialize, "Initialize", {
            "Swap hash": "0x"+swapData.getEscrowHash(),
            "Offerer": swapData.offerer,
            "Claimer": swapData.claimer,
            "Token amount": {
                token_address: swapData.token,
                amount: cairo.uint256(swapData.amount)
            },
            "Pay in": swapData.isPayIn(),
            "Pay out": swapData.isPayOut(),
            "Tracking reputation": swapData.reputation,
            "Refund handler": swapData.refundHandler,
            "Claim handler": swapData.claimHandler,
            "Claim data": "0x"+swapData.getClaimHash(),
            "Refund data": swapData.refundData.startsWith("0x") ? swapData.refundData : "0x"+swapData.refundData,
            "Security deposit": {
                token_address: swapData.feeToken,
                amount: cairo.uint256(swapData.securityDeposit)
            },
            "Claimer bounty": {
                token_address: swapData.feeToken,
                amount: cairo.uint256(swapData.claimerBounty)
            },
            "Claim action hash": 0n,
            "Deadline": toHex(authTimeout)
        });

        return {
            prefix: this.getAuthPrefix(swapData),
            timeout: authTimeout.toString(10),
            signature
        };
    }

    /**
     * Checks whether the provided signature data is valid, using preFetchedData if provided and still valid
     *
     * @param sender
     * @param swapData
     * @param timeout
     * @param prefix
     * @param signature
     * @param preFetchData
     * @public
     */
    public async isSignatureValid(
        sender: string,
        swapData: StarknetSwapData,
        timeout: string,
        prefix: string,
        signature: string,
        preFetchData?: StarknetPreFetchVerification
    ): Promise<null> {
        if(!swapData.isOfferer(sender) && !swapData.isClaimer(sender))
            throw new SignatureVerificationError("TX sender not offerer nor claimer");

        const signer = swapData.isOfferer(sender) ? swapData.claimer : swapData.offerer;

        if(!swapData.isPayIn() && await this.contract.isExpired(sender.toString(), swapData)) {
            throw new SignatureVerificationError("Swap will expire too soon!");
        }

        if(prefix!==this.getAuthPrefix(swapData)) throw new SignatureVerificationError("Invalid prefix");

        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        const timeoutBN = BigInt(timeout);
        const isExpired = (timeoutBN - currentTimestamp) < BigInt(this.contract.authGracePeriod);
        if (isExpired) throw new SignatureVerificationError("Authorization expired!");
        if(await this.isSignatureSoftExpired(timeout, preFetchData)) throw new SignatureVerificationError("Authorization expired!");

        const valid = await this.root.Signatures.isValidSignature(signature, signer, Initialize, "Initialize", {
            "Swap hash": "0x"+swapData.getEscrowHash(),
            "Offerer": swapData.offerer,
            "Claimer": swapData.claimer,
            "Token amount": {
                token_address: swapData.token,
                amount: cairo.uint256(swapData.amount)
            },
            "Pay in": swapData.isPayIn(),
            "Pay out": swapData.isPayOut(),
            "Tracking reputation": swapData.reputation,
            "Refund handler": swapData.refundHandler,
            "Claim handler": swapData.claimHandler,
            "Claim data": "0x"+swapData.getClaimHash(),
            "Refund data": swapData.refundData.startsWith("0x") ? swapData.refundData : "0x"+swapData.refundData,
            "Security deposit": {
                token_address: swapData.feeToken,
                amount: cairo.uint256(swapData.securityDeposit)
            },
            "Claimer bounty": {
                token_address: swapData.feeToken,
                amount: cairo.uint256(swapData.claimerBounty)
            },
            "Claim action hash": 0n,
            "Deadline": toHex(timeoutBN)
        });

        if(!valid) throw new SignatureVerificationError("Invalid signature!");

        return null;
    }

    /**
     * Gets expiry of the provided signature data, this is a minimum of slot expiry & swap signature expiry
     *
     * @param timeout
     * @public
     */
    public async getSignatureExpiry(
        timeout: string
    ): Promise<number> {
        const now = Date.now();
        const timeoutExpiryTime = (parseInt(timeout)-this.contract.authGracePeriod)*1000;

        if(timeoutExpiryTime<now) return 0;

        return timeoutExpiryTime;
    }

    /**
     * Checks whether signature is soft expired, compares the timestamp to the current "pre-confirmed" block timestamp
     *
     * @param timeout
     * @param preFetchData
     * @public
     */
    public async isSignatureSoftExpired(
        timeout: string,
        preFetchData?: StarknetPreFetchVerification
    ): Promise<boolean> {
        if(preFetchData==null || preFetchData.pendingBlockTime==null) {
            preFetchData = await this.preFetchForInitSignatureVerification();
        }
        return preFetchData.pendingBlockTime > parseInt(timeout);
    }

    /**
     * Checks whether signature is expired for good, compares the timestamp to the current "latest" block timestamp
     *
     * @param timeout
     * @public
     */
    public async isSignatureExpired(
        timeout: string
    ): Promise<boolean> {
        const blockTime = await this.root.Blocks.getBlockTime(BlockTag.LATEST);
        return blockTime > parseInt(timeout);
    }

    /**
     * Creates init transaction with a valid signature from an LP
     *
     * @param sender
     * @param swapData swap to initialize
     * @param timeout init signature timeout
     * @param prefix init signature prefix
     * @param signature init signature
     * @param skipChecks whether to skip signature validity checks
     * @param feeRate fee rate to use for the transaction
     */
    public async txsInit(
        sender: string,
        swapData: StarknetSwapData,
        timeout: string,
        prefix: string,
        signature: string,
        skipChecks?: boolean,
        feeRate?: string
    ): Promise<StarknetTx[]> {
        if(!skipChecks) {
            const [_, payStatus] = await Promise.all([
                swapData.isOfferer(sender) && !swapData.reputation ? Promise.resolve() : tryWithRetries(
                    () => this.isSignatureValid(sender, swapData, timeout, prefix, signature),
                    this.retryPolicy, (e) => e instanceof SignatureVerificationError
                ),
                tryWithRetries(() => this.contract.getCommitStatus(sender, swapData), this.retryPolicy)
            ]);
            if(payStatus.type!==SwapCommitStateType.NOT_COMMITED) throw new SwapDataVerificationError("Invoice already being paid for or paid");
        }

        feeRate ??= await this.root.Fees.getFeeRate();

        const initAction = this.Init(sender, swapData, BigInt(timeout), JSON.parse(signature));
        if(swapData.payIn && swapData.isOfferer(sender)) initAction.addAction(
            this.root.Tokens.Approve(sender, this.swapContract.address, swapData.token, swapData.amount), 0
        ); //Add erc20 approve
        if(swapData.getTotalDeposit() !== 0n) initAction.addAction(
            this.root.Tokens.Approve(sender, this.swapContract.address, swapData.feeToken, swapData.getTotalDeposit()), 0
        ); //Add deposit erc20 approve

        this.logger.debug("txsInitPayIn(): create swap init TX, swap: "+swapData.getClaimHash()+
            " feerate: "+feeRate);

        return [await initAction.tx(feeRate)];
    }

    /**
     * Get the estimated solana fee of the init transaction, this includes the required deposit for creating swap PDA
     *  and also deposit for ATAs
     */
    async getInitFee(swapData?: StarknetSwapData, feeRate?: string): Promise<bigint> {
        feeRate ??= await this.root.Fees.getFeeRate();
        return StarknetFees.getGasFee(swapData.payIn ? StarknetSwapInit.GasCosts.INIT_PAY_IN : StarknetSwapInit.GasCosts.INIT, feeRate);
    }
}