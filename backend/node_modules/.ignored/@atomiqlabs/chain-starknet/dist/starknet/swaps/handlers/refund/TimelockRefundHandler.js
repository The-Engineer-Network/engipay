"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelockRefundHandler = void 0;
const Utils_1 = require("../../../../utils/Utils");
class TimelockRefundHandler {
    constructor(address) {
        this.address = address;
    }
    getCommitment(data) {
        return data;
    }
    getWitness(signer, data) {
        const expiry = TimelockRefundHandler.getExpiry(data);
        const currentTimestamp = BigInt(Math.floor(Date.now() / 1000));
        if (expiry > currentTimestamp)
            throw new Error("Not expired yet!");
        return Promise.resolve({ initialTxns: [], witness: [] });
    }
    getGas() {
        return TimelockRefundHandler.gas;
    }
    static getExpiry(data) {
        return (0, Utils_1.bigNumberishToBuffer)(data.refundData, 32).readBigUInt64BE(24).valueOf();
    }
}
exports.TimelockRefundHandler = TimelockRefundHandler;
TimelockRefundHandler.gas = { l1DataGas: 0, l2Gas: 4000000, l1Gas: 0 };
