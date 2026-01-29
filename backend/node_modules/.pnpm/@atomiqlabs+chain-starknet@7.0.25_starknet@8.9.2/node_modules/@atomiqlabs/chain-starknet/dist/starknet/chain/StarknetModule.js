"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetModule = void 0;
const Utils_1 = require("../../utils/Utils");
class StarknetModule {
    constructor(root) {
        this.logger = (0, Utils_1.getLogger)(this.constructor.name + ": ");
        this.provider = root.provider;
        this.retryPolicy = root.retryPolicy;
        this.root = root;
    }
}
exports.StarknetModule = StarknetModule;
