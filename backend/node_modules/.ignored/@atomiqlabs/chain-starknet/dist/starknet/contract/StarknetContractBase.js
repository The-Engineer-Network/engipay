"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetContractBase = void 0;
const starknet_1 = require("starknet");
const StarknetContractEvents_1 = require("./modules/StarknetContractEvents");
/**
 * Base class providing program specific utilities
 */
class StarknetContractBase {
    constructor(chainInterface, contractAddress, contractAbi) {
        this.Chain = chainInterface;
        this.contract = new starknet_1.Contract({
            abi: contractAbi,
            address: contractAddress,
            providerOrAccount: chainInterface.provider
        }).typedv2(contractAbi);
        this.Events = new StarknetContractEvents_1.StarknetContractEvents(chainInterface, this, contractAbi);
    }
}
exports.StarknetContractBase = StarknetContractBase;
