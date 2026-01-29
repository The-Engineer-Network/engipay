"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpvVaultFrontEvent = void 0;
const SpvVaultEvent_1 = require("./SpvVaultEvent");
class SpvVaultFrontEvent extends SpvVaultEvent_1.SpvVaultEvent {
    constructor(owner, vaultId, btcTxId, recipient, executionHash, amounts, frontingAddress) {
        super(owner, vaultId);
        this.eventType = SpvVaultEvent_1.SpvVaultEventType.FRONT;
        this.btcTxId = btcTxId;
        this.recipient = recipient;
        this.executionHash = executionHash;
        this.amounts = amounts;
        this.frontingAddress = frontingAddress;
    }
}
exports.SpvVaultFrontEvent = SpvVaultFrontEvent;
