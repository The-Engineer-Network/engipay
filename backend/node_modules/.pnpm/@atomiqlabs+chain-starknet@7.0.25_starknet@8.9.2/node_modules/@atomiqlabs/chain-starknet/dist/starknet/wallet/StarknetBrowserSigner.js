"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StarknetBrowserSigner = void 0;
const StarknetSigner_1 = require("./StarknetSigner");
class StarknetBrowserSigner extends StarknetSigner_1.StarknetSigner {
    constructor(account) {
        super(account, false);
        this.signTransaction = null;
    }
}
exports.StarknetBrowserSigner = StarknetBrowserSigner;
