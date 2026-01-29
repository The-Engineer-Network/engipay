"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapEvent = exports.SwapEventType = void 0;
const ChainEvent_1 = require("../ChainEvent");
var SwapEventType;
(function (SwapEventType) {
    SwapEventType[SwapEventType["INITIALIZE"] = 0] = "INITIALIZE";
    SwapEventType[SwapEventType["REFUND"] = 1] = "REFUND";
    SwapEventType[SwapEventType["CLAIM"] = 2] = "CLAIM";
})(SwapEventType = exports.SwapEventType || (exports.SwapEventType = {}));
class SwapEvent extends ChainEvent_1.ChainEvent {
    constructor(escrowHash) {
        super();
        this.escrowHash = escrowHash;
    }
}
exports.SwapEvent = SwapEvent;
