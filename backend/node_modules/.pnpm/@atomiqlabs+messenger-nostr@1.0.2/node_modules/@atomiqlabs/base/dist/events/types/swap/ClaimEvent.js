"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaimEvent = void 0;
const SwapEvent_1 = require("./SwapEvent");
class ClaimEvent extends SwapEvent_1.SwapEvent {
    constructor(escrowHash, result) {
        super(escrowHash);
        this.result = result;
    }
}
exports.ClaimEvent = ClaimEvent;
