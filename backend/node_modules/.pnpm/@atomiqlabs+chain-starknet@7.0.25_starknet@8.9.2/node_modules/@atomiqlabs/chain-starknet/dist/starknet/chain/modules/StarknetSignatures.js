"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSignatures = void 0;
const buffer_1 = require("buffer");
const StarknetModule_1 = require("../StarknetModule");
const starknet_1 = require("starknet");
const Utils_1 = require("../../../utils/Utils");
const sha2_1 = require("@noble/hashes/sha2");
const StarknetDomain = [
    { name: 'name', type: 'shortstring' },
    { name: 'version', type: 'shortstring' },
    { name: 'chainId', type: 'shortstring' },
    { name: 'revision', type: 'shortstring' },
];
const DataHash = [
    { name: 'Data hash', type: 'u256' }
];
class StarknetSignatures extends StarknetModule_1.StarknetModule {
    constructor(root, domainName = "atomiq.exchange") {
        super(root);
        this.domain = {
            name: domainName,
            version: '1',
            chainId: starknet_1.shortString.decodeShortString(root.starknetChainId),
            revision: '1'
        };
    }
    getTypedMessage(type, typeName, message) {
        return {
            types: {
                StarknetDomain,
                [typeName]: type,
            },
            primaryType: typeName,
            domain: this.domain,
            message
        };
    }
    async signTypedMessage(signer, type, typeName, message) {
        const signature = await signer.account.signMessage(this.getTypedMessage(type, typeName, message));
        return JSON.stringify(starknet_1.stark.formatSignature(signature));
    }
    async isValidSignature(signature, address, type, typeName, message) {
        return this.provider.verifyMessageInStarknet(this.getTypedMessage(type, typeName, message), JSON.parse(signature), address);
    }
    ///////////////////
    //// Data signatures
    /**
     * Produces a signature over the sha256 of a specified data Buffer, only works with providers which
     *  expose their private key (i.e. backend based, not browser wallet based)
     *
     * @param signer
     * @param data data to sign
     */
    getDataSignature(signer, data) {
        const buff = buffer_1.Buffer.from((0, sha2_1.sha256)(data));
        return this.signTypedMessage(signer, DataHash, 'DataHash', { "Data hash": starknet_1.cairo.uint256((0, Utils_1.toHex)(buff)) });
    }
    /**
     * Checks whether a signature is a valid signature produced by the account over a data message (computes
     *  sha256 hash of the message)
     *
     * @param data signed data
     * @param signature data signature
     * @param address public key of the signer
     */
    isValidDataSignature(data, signature, address) {
        const buff = buffer_1.Buffer.from((0, sha2_1.sha256)(data));
        return this.isValidSignature(signature, address, DataHash, 'DataHash', { "Data hash": starknet_1.cairo.uint256((0, Utils_1.toHex)(buff)) });
    }
}
exports.StarknetSignatures = StarknetSignatures;
