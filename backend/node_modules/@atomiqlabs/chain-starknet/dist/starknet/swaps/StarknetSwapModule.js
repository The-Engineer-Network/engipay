"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetSwapModule = void 0;
const StarknetContractModule_1 = require("../contract/StarknetContractModule");
class StarknetSwapModule extends StarknetContractModule_1.StarknetContractModule {
    constructor(chainInterface, contract) {
        super(chainInterface, contract);
        this.swapContract = contract.contract;
    }
}
exports.StarknetSwapModule = StarknetSwapModule;
