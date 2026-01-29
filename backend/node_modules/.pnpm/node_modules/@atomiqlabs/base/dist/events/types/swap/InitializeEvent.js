"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitializeEvent = void 0;
const SwapEvent_1 = require("./SwapEvent");
class InitializeEvent extends SwapEvent_1.SwapEvent {
    constructor(escrowHash, swapType, swapData) {
        super(escrowHash);
        this.swapType = swapType;
        this.swapData = swapData;
    }
}
exports.InitializeEvent = InitializeEvent;
