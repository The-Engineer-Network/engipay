"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCoinselectAddressType = exports.toOutputScript = void 0;
const utils_1 = require("@scure/btc-signer/utils");
const buffer_1 = require("buffer");
const btc_signer_1 = require("@scure/btc-signer");
function toOutputScript(network, address) {
    const outputScript = (0, btc_signer_1.Address)(network).decode(address);
    switch (outputScript.type) {
        case "pkh":
        case "sh":
        case "wpkh":
        case "wsh":
            return buffer_1.Buffer.from(btc_signer_1.OutScript.encode({
                type: outputScript.type,
                hash: outputScript.hash
            }));
        case "tr":
            try {
                return buffer_1.Buffer.from(btc_signer_1.OutScript.encode({
                    type: "tr",
                    pubkey: outputScript.pubkey
                }));
            }
            catch (e) {
                let msg = "";
                if (e.name != null)
                    msg += ": " + e.name;
                if (e.message != null)
                    msg += ": " + e.message;
                if (typeof (e) === "string")
                    msg += ": " + e;
                msg += ", isBytes: " + (0, utils_1.isBytes)(outputScript.pubkey);
                try {
                    (0, utils_1.validatePubkey)(outputScript.pubkey, utils_1.PubT.schnorr);
                    msg += ", validatePubkey: success";
                }
                catch (e) {
                    msg += ", validatePubkeyError: ";
                    if (e.name != null)
                        msg += ": " + e.name;
                    if (e.message != null)
                        msg += ": " + e.message;
                    if (typeof (e) === "string")
                        msg += ": " + e;
                }
                throw new Error(msg);
            }
    }
}
exports.toOutputScript = toOutputScript;
function toCoinselectAddressType(outputScript) {
    const data = btc_signer_1.OutScript.decode(outputScript);
    switch (data.type) {
        case "pkh":
            return "p2pkh";
        case "sh":
            return "p2sh-p2wpkh";
        case "wpkh":
            return "p2wpkh";
        case "wsh":
            return "p2wsh";
        case "tr":
            return "p2tr";
    }
    throw new Error("Unrecognized address type!");
}
exports.toCoinselectAddressType = toCoinselectAddressType;
