"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultEvent = exports.SpvVaultEventType = void 0;
const ChainEvent_1 = require("../ChainEvent");
var SpvVaultEventType;
(function (SpvVaultEventType) {
    SpvVaultEventType[SpvVaultEventType["OPEN"] = 0] = "OPEN";
    SpvVaultEventType[SpvVaultEventType["DEPOSIT"] = 1] = "DEPOSIT";
    SpvVaultEventType[SpvVaultEventType["CLAIM"] = 2] = "CLAIM";
    SpvVaultEventType[SpvVaultEventType["CLOSE"] = 3] = "CLOSE";
    SpvVaultEventType[SpvVaultEventType["FRONT"] = 4] = "FRONT";
})(SpvVaultEventType = exports.SpvVaultEventType || (exports.SpvVaultEventType = {}));
class SpvVaultEvent extends ChainEvent_1.ChainEvent {
    constructor(owner, vaultId) {
        super();
        this.owner = owner;
        this.vaultId = vaultId;
    }
}
exports.SpvVaultEvent = SpvVaultEvent;
