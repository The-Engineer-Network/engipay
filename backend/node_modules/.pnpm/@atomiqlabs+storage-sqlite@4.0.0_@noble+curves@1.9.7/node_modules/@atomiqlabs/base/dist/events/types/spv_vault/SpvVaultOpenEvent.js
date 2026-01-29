"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultOpenEvent = void 0;
const SpvVaultEvent_1 = require("./SpvVaultEvent");
class SpvVaultOpenEvent extends SpvVaultEvent_1.SpvVaultEvent {
    constructor(owner, vaultId, btcTxId, vout) {
        super(owner, vaultId);
        this.eventType = SpvVaultEvent_1.SpvVaultEventType.OPEN;
        this.btcTxId = btcTxId;
        this.vout = vout;
    }
}
exports.SpvVaultOpenEvent = SpvVaultOpenEvent;
