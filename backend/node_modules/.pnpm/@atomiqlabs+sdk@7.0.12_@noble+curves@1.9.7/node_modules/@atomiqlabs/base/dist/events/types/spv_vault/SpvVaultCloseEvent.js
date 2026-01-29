"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultCloseEvent = void 0;
const SpvVaultEvent_1 = require("./SpvVaultEvent");
class SpvVaultCloseEvent extends SpvVaultEvent_1.SpvVaultEvent {
    constructor(owner, vaultId, btcTxId, error) {
        super(owner, vaultId);
        this.eventType = SpvVaultEvent_1.SpvVaultEventType.CLOSE;
        this.btcTxId = btcTxId;
        this.error = error;
    }
}
exports.SpvVaultCloseEvent = SpvVaultCloseEvent;
