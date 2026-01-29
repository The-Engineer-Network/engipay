"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetAddresses = void 0;
const StarknetModule_1 = require("../StarknetModule");
const starknet_1 = require("starknet");
class StarknetAddresses extends StarknetModule_1.StarknetModule {
    ///////////////////
    //// Address utils
    /**
     * Checks whether an address is a valid starknet address
     *
     * @param value
     * @param lenient
     */
    static isValidAddress(value, lenient) {
        if (!lenient && value.length !== 66)
            return false;
        try {
            (0, starknet_1.validateAndParseAddress)(value);
            return true;
        }
        catch (e) {
            return false;
        }
    }
}
exports.StarknetAddresses = StarknetAddresses;
