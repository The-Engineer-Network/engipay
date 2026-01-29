"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SingleAddressBitcoinWallet = void 0;
const utils_1 = require("@scure/btc-signer/utils");
const btc_signer_1 = require("@scure/btc-signer");
const buffer_1 = require("buffer");
const BitcoinWallet_1 = require("./BitcoinWallet");
class SingleAddressBitcoinWallet extends BitcoinWallet_1.BitcoinWallet {
    constructor(mempoolApi, network, addressDataOrWIF, feeMultiplier = 1.25, feeOverride) {
        super(mempoolApi, network, feeMultiplier, feeOverride);
        if (typeof (addressDataOrWIF) === "string") {
            try {
                this.privKey = (0, btc_signer_1.WIF)(network).decode(addressDataOrWIF);
            }
            catch (e) {
                this.privKey = (0, btc_signer_1.WIF)().decode(addressDataOrWIF);
            }
            this.pubkey = (0, utils_1.pubECDSA)(this.privKey);
            this.address = (0, btc_signer_1.getAddress)("wpkh", this.privKey, network);
        }
        else {
            this.address = addressDataOrWIF.address;
            this.pubkey = buffer_1.Buffer.from(addressDataOrWIF.publicKey, "hex");
        }
        this.addressType = (0, BitcoinWallet_1.identifyAddressType)(this.address, network);
    }
    toBitcoinWalletAccounts() {
        return [{
                pubkey: buffer_1.Buffer.from(this.pubkey).toString("hex"), address: this.address, addressType: this.addressType
            }];
    }
    async sendTransaction(address, amount, feeRate) {
        if (!this.privKey)
            throw new Error("Not supported.");
        const { psbt } = await super._getPsbt(this.toBitcoinWalletAccounts(), address, Number(amount), feeRate);
        psbt.sign(this.privKey);
        psbt.finalize();
        const txHex = buffer_1.Buffer.from(psbt.extract()).toString("hex");
        return await super._sendTransaction(txHex);
    }
    async fundPsbt(inputPsbt, feeRate) {
        const { psbt } = await super._fundPsbt(this.toBitcoinWalletAccounts(), inputPsbt, feeRate);
        if (psbt == null) {
            throw new Error("Not enough balance!");
        }
        return psbt;
    }
    async signPsbt(psbt, signInputs) {
        if (!this.privKey)
            throw new Error("Not supported.");
        for (let signInput of signInputs) {
            psbt.signIdx(this.privKey, signInput);
        }
        return psbt;
    }
    async getTransactionFee(address, amount, feeRate) {
        const { psbt, fee } = await super._getPsbt(this.toBitcoinWalletAccounts(), address, Number(amount), feeRate);
        if (psbt == null)
            return null;
        return fee;
    }
    async getFundedPsbtFee(basePsbt, feeRate) {
        const { psbt, fee } = await super._fundPsbt(this.toBitcoinWalletAccounts(), basePsbt, feeRate);
        if (psbt == null)
            return null;
        return fee;
    }
    getReceiveAddress() {
        return this.address;
    }
    getBalance() {
        return this._getBalance(this.address);
    }
    getSpendableBalance(psbt, feeRate) {
        return this._getSpendableBalance([{ address: this.address, addressType: this.addressType }], psbt, feeRate);
    }
    static generateRandomPrivateKey(network) {
        return (0, btc_signer_1.WIF)(network).encode((0, utils_1.randomPrivateKeyBytes)());
    }
}
exports.SingleAddressBitcoinWallet = SingleAddressBitcoinWallet;
