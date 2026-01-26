"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSpvVaultContract = void 0;
const base_1 = require("@atomiqlabs/base");
const buffer_1 = require("buffer");
const StarknetContractBase_1 = require("../contract/StarknetContractBase");
const StarknetBtcRelay_1 = require("../btcrelay/StarknetBtcRelay");
const starknet_1 = require("starknet");
const StarknetAction_1 = require("../chain/StarknetAction");
const SpvVaultContractAbi_1 = require("./SpvVaultContractAbi");
const StarknetSpvVaultData_1 = require("./StarknetSpvVaultData");
const StarknetSpvWithdrawalData_1 = require("./StarknetSpvWithdrawalData");
const Utils_1 = require("../../utils/Utils");
const StarknetAddresses_1 = require("../chain/modules/StarknetAddresses");
const StarknetFees_1 = require("../chain/modules/StarknetFees");
const spvVaultContractAddreses = {
    [starknet_1.constants.StarknetChainId.SN_SEPOLIA]: "0x02d581ea838cd5ca46ba08660eddd064d50a0392f618e95310432147928d572e",
    [starknet_1.constants.StarknetChainId.SN_MAIN]: "0x01932042992647771f3d0aa6ee526e65359c891fe05a285faaf4d3ffa373e132"
};
const STARK_PRIME_MOD = 2n ** 251n + 17n * 2n ** 192n + 1n;
function decodeUtxo(utxo) {
    const [txId, vout] = utxo.split(":");
    return {
        txHash: BigInt("0x" + buffer_1.Buffer.from(txId, "hex").reverse().toString("hex")),
        vout: BigInt(vout)
    };
}
class StarknetSpvVaultContract extends StarknetContractBase_1.StarknetContractBase {
    constructor(chainInterface, btcRelay, bitcoinRpc, contractAddress = spvVaultContractAddreses[chainInterface.starknetChainId]) {
        super(chainInterface, contractAddress, SpvVaultContractAbi_1.SpvVaultContractAbi);
        this.chainId = "STARKNET";
        this.claimTimeout = 180;
        this.maxClaimsPerTx = 10;
        this.logger = (0, Utils_1.getLogger)("StarknetSpvVaultContract: ");
        this.btcRelay = btcRelay;
        this.bitcoinRpc = bitcoinRpc;
    }
    //StarknetActions
    Open(signer, vault) {
        const { txHash, vout } = decodeUtxo(vault.getUtxo());
        const tokens = vault.getTokenData();
        if (tokens.length !== 2)
            throw new Error("Must specify exactly 2 tokens for vault!");
        return new StarknetAction_1.StarknetAction(signer, this.Chain, this.contract.populateTransaction.open(vault.getVaultId(), this.btcRelay.contract.address, starknet_1.cairo.tuple(starknet_1.cairo.uint256(txHash), vout), vault.getConfirmations(), tokens[0].token, tokens[1].token, tokens[0].multiplier, tokens[1].multiplier), StarknetSpvVaultContract.GasCosts.OPEN);
    }
    Deposit(signer, vault, rawAmounts) {
        return new StarknetAction_1.StarknetAction(signer, this.Chain, this.contract.populateTransaction.deposit(vault.getOwner(), vault.getVaultId(), rawAmounts[0], rawAmounts[1] ?? 0n), StarknetSpvVaultContract.GasCosts.DEPOSIT);
    }
    Front(signer, vault, data, withdrawalSequence) {
        return new StarknetAction_1.StarknetAction(signer, this.Chain, this.contract.populateTransaction.front(vault.getOwner(), vault.getVaultId(), BigInt(withdrawalSequence), data.getTxHash(), data.serializeToStruct()), StarknetSpvVaultContract.GasCosts.FRONT);
    }
    Claim(signer, vault, data, blockheader, merkle, position) {
        return new StarknetAction_1.StarknetAction(signer, this.Chain, {
            contractAddress: this.contract.address,
            entrypoint: "claim",
            calldata: [
                vault.getOwner(),
                vault.getVaultId(),
                ...(0, Utils_1.bufferToByteArray)(buffer_1.Buffer.from(data.btcTx.hex, "hex")),
                ...blockheader.serialize(),
                merkle.length,
                ...merkle.map(Utils_1.bufferToU32Array).flat(),
                position,
            ].map(val => (0, Utils_1.toHex)(val, 0))
        }, StarknetSpvVaultContract.GasCosts.CLAIM);
    }
    async checkWithdrawalTx(tx) {
        const result = await this.Chain.provider.callContract({
            contractAddress: this.contract.address,
            entrypoint: "parse_bitcoin_tx",
            calldata: (0, Utils_1.bufferToByteArray)(buffer_1.Buffer.from(tx.btcTx.hex, "hex"))
        });
        if (result == null)
            throw new Error("Failed to parse transaction!");
    }
    createVaultData(owner, vaultId, utxo, confirmations, tokenData) {
        if (tokenData.length !== 2)
            throw new Error("Must specify 2 tokens in tokenData!");
        return Promise.resolve(new StarknetSpvVaultData_1.StarknetSpvVaultData(owner, vaultId, {
            relay_contract: this.btcRelay.contract.address,
            token_0: tokenData[0].token,
            token_1: tokenData[1].token,
            token_0_multiplier: tokenData[0].multiplier,
            token_1_multiplier: tokenData[1].multiplier,
            utxo: starknet_1.cairo.tuple(starknet_1.cairo.uint256(0), 0),
            confirmations: confirmations,
            withdraw_count: 0,
            deposit_count: 0,
            token_0_amount: 0n,
            token_1_amount: 0n
        }, utxo));
    }
    //Getters
    async getVaultData(owner, vaultId) {
        const struct = await this.contract.get_vault(owner, vaultId);
        if ((0, Utils_1.toHex)(struct.relay_contract) !== (0, Utils_1.toHex)(this.btcRelay.contract.address))
            return null;
        return new StarknetSpvVaultData_1.StarknetSpvVaultData(owner, vaultId, struct);
    }
    async getMultipleVaultData(vaults) {
        const result = {};
        let promises = [];
        //TODO: We can upgrade this to use multicall
        for (let { owner, vaultId } of vaults) {
            promises.push(this.getVaultData(owner, vaultId).then(val => {
                result[owner] ?? (result[owner] = {});
                result[owner][vaultId.toString(10)] = val;
            }));
            if (promises.length >= this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }
    async getVaultLatestUtxo(owner, vaultId) {
        const vault = await this.getVaultData(owner, vaultId);
        if (vault == null)
            return null;
        if (!vault.isOpened())
            return null;
        return vault.getUtxo();
    }
    async getVaultLatestUtxos(vaults) {
        const result = {};
        let promises = [];
        //TODO: We can upgrade this to use multicall
        for (let { owner, vaultId } of vaults) {
            promises.push(this.getVaultLatestUtxo(owner, vaultId).then(val => {
                result[owner] ?? (result[owner] = {});
                result[owner][vaultId.toString(10)] = val;
            }));
            if (promises.length >= this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }
    async getAllVaults(owner) {
        const openedVaults = new Set();
        await this.Events.findInContractEventsForward(["spv_swap_vault::events::Opened", "spv_swap_vault::events::Closed"], owner == null ? null : [null, owner], (event) => {
            const owner = (0, Utils_1.toHex)(event.params.owner);
            const vaultId = (0, Utils_1.toBigInt)(event.params.vault_id);
            const vaultIdentifier = owner + ":" + vaultId.toString(10);
            if (event.name === "spv_swap_vault::events::Opened") {
                openedVaults.add(vaultIdentifier);
            }
            else {
                openedVaults.delete(vaultIdentifier);
            }
            return null;
        });
        const vaults = [];
        for (let identifier of openedVaults.keys()) {
            const [owner, vaultIdStr] = identifier.split(":");
            const vaultData = await this.getVaultData(owner, BigInt(vaultIdStr));
            if (vaultData != null)
                vaults.push(vaultData);
        }
        return vaults;
    }
    async getFronterAddress(owner, vaultId, withdrawal) {
        const fronterAddress = await this.contract.get_fronter_address_by_id(owner, vaultId, "0x" + withdrawal.getFrontingId());
        if ((0, Utils_1.toHex)(fronterAddress, 64) === "0x0000000000000000000000000000000000000000000000000000000000000000")
            return null;
        return fronterAddress;
    }
    async getFronterAddresses(withdrawals) {
        const result = {};
        let promises = [];
        //TODO: We can upgrade this to use multicall
        for (let { owner, vaultId, withdrawal } of withdrawals) {
            promises.push(this.getFronterAddress(owner, vaultId, withdrawal).then(val => {
                result[withdrawal.getTxId()] = val;
            }));
            if (promises.length >= this.Chain.config.maxParallelCalls) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        return result;
    }
    parseWithdrawalEvent(event) {
        switch (event.name) {
            case "spv_swap_vault::events::Fronted":
                return {
                    type: base_1.SpvWithdrawalStateType.FRONTED,
                    txId: event.txHash,
                    owner: (0, Utils_1.toHex)(event.params.owner),
                    vaultId: (0, Utils_1.toBigInt)(event.params.vault_id),
                    recipient: (0, Utils_1.toHex)(event.params.recipient),
                    fronter: (0, Utils_1.toHex)(event.params.fronting_address)
                };
            case "spv_swap_vault::events::Claimed":
                return {
                    type: base_1.SpvWithdrawalStateType.CLAIMED,
                    txId: event.txHash,
                    owner: (0, Utils_1.toHex)(event.params.owner),
                    vaultId: (0, Utils_1.toBigInt)(event.params.vault_id),
                    recipient: (0, Utils_1.toHex)(event.params.recipient),
                    claimer: (0, Utils_1.toHex)(event.params.caller),
                    fronter: (0, Utils_1.toHex)(event.params.fronting_address)
                };
            case "spv_swap_vault::events::Closed":
                return {
                    type: base_1.SpvWithdrawalStateType.CLOSED,
                    txId: event.txHash,
                    owner: (0, Utils_1.toHex)(event.params.owner),
                    vaultId: (0, Utils_1.toBigInt)(event.params.vault_id),
                    error: (0, Utils_1.bigNumberishToBuffer)(event.params.error).toString()
                };
            default:
                return null;
        }
    }
    async getWithdrawalStates(withdrawalTxs) {
        const result = {};
        withdrawalTxs.forEach(withdrawalTx => {
            result[withdrawalTx.withdrawal.getTxId()] = {
                type: base_1.SpvWithdrawalStateType.NOT_FOUND
            };
        });
        const events = ["spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed", "spv_swap_vault::events::Closed"];
        for (let i = 0; i < withdrawalTxs.length; i += this.Chain.config.maxGetLogKeys) {
            const checkWithdrawalTxs = withdrawalTxs.slice(i, i + this.Chain.config.maxGetLogKeys);
            const lows = [];
            const highs = [];
            let startHeight = undefined;
            checkWithdrawalTxs.forEach(withdrawalTx => {
                const txHash = buffer_1.Buffer.from(withdrawalTx.withdrawal.getTxId(), "hex").reverse();
                const txHashU256 = starknet_1.cairo.uint256("0x" + txHash.toString("hex"));
                lows.push((0, Utils_1.toHex)(txHashU256.low));
                highs.push((0, Utils_1.toHex)(txHashU256.high));
                if (startHeight !== null) {
                    if (withdrawalTx.scStartBlockheight == null) {
                        startHeight = null;
                    }
                    else {
                        startHeight = Math.min(startHeight ?? Infinity, withdrawalTx.scStartBlockheight);
                    }
                }
            });
            await this.Events.findInContractEventsForward(events, [lows, highs], async (event) => {
                const txId = (0, Utils_1.bigNumberishToBuffer)(event.params.btc_tx_hash, 32).reverse().toString("hex");
                if (result[txId] == null) {
                    this.logger.warn(`getWithdrawalStates(): findInContractEvents-callback: loaded event for ${txId}, but transaction not found in input params!`);
                    return;
                }
                const eventResult = this.parseWithdrawalEvent(event);
                if (eventResult != null)
                    result[txId] = eventResult;
            }, startHeight);
        }
        return result;
    }
    async getWithdrawalState(withdrawalTx, scStartBlockheight) {
        const txHash = buffer_1.Buffer.from(withdrawalTx.getTxId(), "hex").reverse();
        const txHashU256 = starknet_1.cairo.uint256("0x" + txHash.toString("hex"));
        let result = {
            type: base_1.SpvWithdrawalStateType.NOT_FOUND
        };
        const events = ["spv_swap_vault::events::Fronted", "spv_swap_vault::events::Claimed", "spv_swap_vault::events::Closed"];
        const keys = [(0, Utils_1.toHex)(txHashU256.low), (0, Utils_1.toHex)(txHashU256.high)];
        await this.Events.findInContractEventsForward(events, keys, async (event) => {
            const eventResult = this.parseWithdrawalEvent(event);
            if (eventResult != null)
                result = eventResult;
        }, scStartBlockheight);
        return result;
    }
    getWithdrawalData(btcTx) {
        return Promise.resolve(new StarknetSpvWithdrawalData_1.StarknetSpvWithdrawalData(btcTx));
    }
    //OP_RETURN data encoding/decoding
    fromOpReturnData(data) {
        return StarknetSpvVaultContract.fromOpReturnData(data);
    }
    static fromOpReturnData(data) {
        let rawAmount0 = 0n;
        let rawAmount1 = 0n;
        let executionHash = null;
        if (data.length === 40) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
        }
        else if (data.length === 48) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
            rawAmount1 = data.readBigInt64LE(40).valueOf();
        }
        else if (data.length === 72) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
            executionHash = data.slice(40, 72).toString("hex");
        }
        else if (data.length === 80) {
            rawAmount0 = data.readBigInt64LE(32).valueOf();
            rawAmount1 = data.readBigInt64LE(40).valueOf();
            executionHash = data.slice(48, 80).toString("hex");
        }
        else {
            throw new Error("Invalid OP_RETURN data length!");
        }
        if (executionHash != null) {
            const executionHashValue = BigInt("0x" + executionHash);
            if (executionHashValue >= STARK_PRIME_MOD)
                throw new Error("Execution hash not in range of starknet prime");
        }
        const recipient = "0x" + data.slice(0, 32).toString("hex");
        if (!StarknetAddresses_1.StarknetAddresses.isValidAddress(recipient))
            throw new Error("Invalid recipient specified");
        return { executionHash, rawAmounts: [rawAmount0, rawAmount1], recipient };
    }
    toOpReturnData(recipient, rawAmounts, executionHash) {
        return StarknetSpvVaultContract.toOpReturnData(recipient, rawAmounts, executionHash);
    }
    static toOpReturnData(recipient, rawAmounts, executionHash) {
        if (!StarknetAddresses_1.StarknetAddresses.isValidAddress(recipient))
            throw new Error("Invalid recipient specified");
        if (rawAmounts.length < 1)
            throw new Error("At least 1 amount needs to be specified");
        if (rawAmounts.length > 2)
            throw new Error("At most 2 amounts need to be specified");
        rawAmounts.forEach(val => {
            if (val < 0n)
                throw new Error("Negative raw amount specified");
            if (val >= 2n ** 64n)
                throw new Error("Raw amount overflow");
        });
        if (executionHash != null) {
            const executionHashValue = (0, Utils_1.toBigInt)(executionHash);
            if (executionHashValue < 0n)
                throw new Error("Execution hash negative");
            if (executionHashValue >= STARK_PRIME_MOD)
                throw new Error("Execution hash not in range of starknet prime");
        }
        const recipientBuffer = buffer_1.Buffer.from(recipient.substring(2).padStart(64, "0"), "hex");
        const amount0Buffer = buffer_1.Buffer.from(rawAmounts[0].toString(16).padStart(16, "0"), "hex");
        const amount1Buffer = rawAmounts[1] == null || rawAmounts[1] === 0n ? buffer_1.Buffer.alloc(0) : buffer_1.Buffer.from(rawAmounts[1].toString(16).padStart(16, "0"), "hex");
        const executionHashBuffer = executionHash == null ? buffer_1.Buffer.alloc(0) : buffer_1.Buffer.from(executionHash.substring(2).padStart(64, "0"), "hex");
        return buffer_1.Buffer.concat([
            recipientBuffer,
            amount0Buffer.reverse(),
            amount1Buffer.reverse(),
            executionHashBuffer
        ]);
    }
    //Actions
    async claim(signer, vault, txs, synchronizer, initAta, txOptions) {
        const result = await this.txsClaim(signer.getAddress(), vault, txs, synchronizer, initAta, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }
    async deposit(signer, vault, rawAmounts, txOptions) {
        const result = await this.txsDeposit(signer.getAddress(), vault, rawAmounts, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }
    async frontLiquidity(signer, vault, realWithdrawalTx, withdrawSequence, txOptions) {
        const result = await this.txsFrontLiquidity(signer.getAddress(), vault, realWithdrawalTx, withdrawSequence, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }
    async open(signer, vault, txOptions) {
        const result = await this.txsOpen(signer.getAddress(), vault, txOptions?.feeRate);
        const [signature] = await this.Chain.sendAndConfirm(signer, result, txOptions?.waitForConfirmation, txOptions?.abortSignal);
        return signature;
    }
    //Transactions
    async txsClaim(signer, vault, txs, synchronizer, initAta, feeRate) {
        if (!vault.isOpened())
            throw new Error("Cannot claim from a closed vault!");
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        const txsWithMerkleProofs = [];
        for (let tx of txs) {
            const merkleProof = await this.bitcoinRpc.getMerkleProof(tx.tx.btcTx.txid, tx.tx.btcTx.blockhash);
            this.logger.debug("txsClaim(): merkle proof computed: ", merkleProof);
            txsWithMerkleProofs.push({
                ...merkleProof,
                ...tx
            });
        }
        const starknetTxs = [];
        const storedHeaders = await StarknetBtcRelay_1.StarknetBtcRelay.getCommitedHeadersAndSynchronize(signer, this.btcRelay, txsWithMerkleProofs.filter(tx => tx.storedHeader == null).map(tx => {
            return {
                blockhash: tx.tx.btcTx.blockhash,
                blockheight: tx.blockheight,
                requiredConfirmations: vault.getConfirmations()
            };
        }), starknetTxs, synchronizer, feeRate);
        if (storedHeaders == null)
            throw new Error("Cannot fetch committed header!");
        const actions = txsWithMerkleProofs.map(tx => {
            return this.Claim(signer, vault, tx.tx, tx.storedHeader ?? storedHeaders[tx.tx.btcTx.blockhash], tx.merkle, tx.pos);
        });
        let starknetAction = new StarknetAction_1.StarknetAction(signer, this.Chain);
        for (let action of actions) {
            starknetAction.add(action);
            if (starknetAction.ixsLength() >= this.maxClaimsPerTx) {
                await starknetAction.addToTxs(starknetTxs, feeRate);
                starknetAction = new StarknetAction_1.StarknetAction(signer, this.Chain);
            }
        }
        if (starknetAction.ixsLength() > 0) {
            await starknetAction.addToTxs(starknetTxs, feeRate);
        }
        this.logger.debug("txsClaim(): " + starknetTxs.length + " claim TXs created claiming " + txs.length + " txs, owner: " + vault.getOwner() +
            " vaultId: " + vault.getVaultId().toString(10));
        return starknetTxs;
    }
    async txsDeposit(signer, vault, rawAmounts, feeRate) {
        if (!vault.isOpened())
            throw new Error("Cannot deposit to a closed vault!");
        //Approve first
        const vaultTokens = vault.getTokenData();
        const action = new StarknetAction_1.StarknetAction(signer, this.Chain);
        let realAmount0 = 0n;
        let realAmount1 = 0n;
        if (rawAmounts[0] != null && rawAmounts[0] !== 0n) {
            realAmount0 = rawAmounts[0] * vaultTokens[0].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[0].token, realAmount0));
        }
        if (rawAmounts[1] != null && rawAmounts[1] !== 0n) {
            realAmount1 = rawAmounts[1] * vaultTokens[1].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[1].token, realAmount1));
        }
        action.add(this.Deposit(signer, vault, rawAmounts));
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        this.logger.debug("txsDeposit(): deposit TX created," +
            " token0: " + vaultTokens[0].token + " rawAmount0: " + rawAmounts[0].toString(10) + " amount0: " + realAmount0.toString(10) +
            " token1: " + vaultTokens[1].token + " rawAmount1: " + (rawAmounts[1] ?? 0n).toString(10) + " amount1: " + realAmount1.toString(10));
        return [await action.tx(feeRate)];
    }
    async txsFrontLiquidity(signer, vault, realWithdrawalTx, withdrawSequence, feeRate) {
        if (!vault.isOpened())
            throw new Error("Cannot front on a closed vault!");
        //Approve first
        const vaultTokens = vault.getTokenData();
        const action = new StarknetAction_1.StarknetAction(signer, this.Chain);
        const rawAmounts = realWithdrawalTx.getFrontingAmount();
        let realAmount0 = 0n;
        let realAmount1 = 0n;
        if (rawAmounts[0] != null && rawAmounts[0] !== 0n) {
            realAmount0 = rawAmounts[0] * vaultTokens[0].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[0].token, realAmount0));
        }
        if (rawAmounts[1] != null && rawAmounts[1] !== 0n) {
            realAmount1 = rawAmounts[1] * vaultTokens[1].multiplier;
            action.add(this.Chain.Tokens.Approve(signer, this.contract.address, vaultTokens[1].token, realAmount1));
        }
        action.add(this.Front(signer, vault, realWithdrawalTx, withdrawSequence));
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        this.logger.debug("txsFrontLiquidity(): front TX created," +
            " token0: " + vaultTokens[0].token + " rawAmount0: " + rawAmounts[0].toString(10) + " amount0: " + realAmount0.toString(10) +
            " token1: " + vaultTokens[1].token + " rawAmount1: " + (rawAmounts[1] ?? 0n).toString(10) + " amount1: " + realAmount1.toString(10));
        return [await action.tx(feeRate)];
    }
    async txsOpen(signer, vault, feeRate) {
        if (vault.isOpened())
            throw new Error("Cannot open an already opened vault!");
        const action = this.Open(signer, vault);
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        this.logger.debug("txsOpen(): open TX created, owner: " + vault.getOwner() +
            " vaultId: " + vault.getVaultId().toString(10));
        return [await action.tx(feeRate)];
    }
    async getClaimFee(signer, vault, withdrawalData, feeRate) {
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        return StarknetFees_1.StarknetFees.getGasFee(withdrawalData == null ? StarknetSpvVaultContract.GasCosts.CLAIM_OPTIMISTIC_ESTIMATE : StarknetSpvVaultContract.GasCosts.CLAIM, feeRate);
    }
    async getFrontFee(signer, vault, withdrawalData, feeRate) {
        feeRate ?? (feeRate = await this.Chain.Fees.getFeeRate());
        return StarknetFees_1.StarknetFees.getGasFee(StarknetSpvVaultContract.GasCosts.FRONT, feeRate);
    }
}
exports.StarknetSpvVaultContract = StarknetSpvVaultContract;
StarknetSpvVaultContract.GasCosts = {
    DEPOSIT: { l1DataGas: 400, l2Gas: 4000000, l1Gas: 0 },
    OPEN: { l1DataGas: 1200, l2Gas: 3200000, l1Gas: 0 },
    FRONT: { l1DataGas: 800, l2Gas: 12000000, l1Gas: 0 },
    CLAIM: { l1DataGas: 1000, l2Gas: 400000000, l1Gas: 0 },
    CLAIM_OPTIMISTIC_ESTIMATE: { l1DataGas: 1000, l2Gas: 80000000, l1Gas: 0 } //If claimer uses sierra 1.7.0 or later
};
