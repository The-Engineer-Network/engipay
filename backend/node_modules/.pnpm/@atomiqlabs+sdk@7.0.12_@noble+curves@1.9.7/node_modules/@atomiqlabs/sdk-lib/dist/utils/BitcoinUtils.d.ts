/// <reference types="node" />
/// <reference types="node" />
import { BTC_NETWORK } from "@scure/btc-signer/utils";
import { Buffer } from "buffer";
import { CoinselectAddressTypes } from "../btc/coinselect2";
export declare function toOutputScript(network: BTC_NETWORK, address: string): Buffer;
export declare function toCoinselectAddressType(outputScript: Uint8Array): CoinselectAddressTypes;
