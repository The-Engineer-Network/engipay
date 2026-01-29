import {BTC_NETWORK, isBytes, PubT, validatePubkey} from "@scure/btc-signer/utils";
import {Buffer} from "buffer";
import {Address, OutScript} from "@scure/btc-signer";
import {CoinselectAddressTypes} from "../btc/coinselect2";

export function toOutputScript(network: BTC_NETWORK, address: string): Buffer {
    const outputScript = Address(network).decode(address);
    switch(outputScript.type) {
        case "pkh":
        case "sh":
        case "wpkh":
        case "wsh":
            return Buffer.from(OutScript.encode({
                type: outputScript.type,
                hash: outputScript.hash
            }));
        case "tr":
            try {
                return Buffer.from(OutScript.encode({
                    type: "tr",
                    pubkey: outputScript.pubkey
                }));
            } catch (e) {
                let msg = "";
                if(e.name!=null) msg += ": "+e.name;
                if(e.message!=null) msg += ": "+e.message;
                if(typeof(e)==="string") msg += ": "+e;
                msg += ", isBytes: "+isBytes(outputScript.pubkey);
                try {
                    validatePubkey(outputScript.pubkey, PubT.schnorr)
                    msg += ", validatePubkey: success";
                } catch (e) {
                    msg += ", validatePubkeyError: ";
                    if(e.name!=null) msg += ": "+e.name;
                    if(e.message!=null) msg += ": "+e.message;
                    if(typeof(e)==="string") msg += ": "+e;
                }
                throw new Error(msg);
            }
    }
}

export function toCoinselectAddressType(outputScript: Uint8Array): CoinselectAddressTypes {
    const data = OutScript.decode(outputScript);
    switch(data.type) {
        case "pkh":
            return "p2pkh";
        case "sh":
            return "p2sh-p2wpkh";
        case "wpkh":
            return "p2wpkh"
        case "wsh":
            return "p2wsh"
        case "tr":
            return "p2tr"
    }
    throw new Error("Unrecognized address type!");
}
