"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetContractModule = void 0;
const StarknetModule_1 = require("../chain/StarknetModule");
class StarknetContractModule extends StarknetModule_1.StarknetModule {
    constructor(chainInterface, contract) {
        super(chainInterface);
        this.contract = contract;
    }
}
exports.StarknetContractModule = StarknetContractModule;
