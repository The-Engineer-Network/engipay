"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.blackjack = void 0;
const utils_1 = require("./utils");
// add inputs until we reach or surpass the target value (or deplete)
// worst-case: O(n)
function blackjack(utxos, outputs, feeRate, type, requiredInputs) {
    if (!isFinite(utils_1.utils.uintOrNaN(feeRate)))
        return null;
    const inputs = requiredInputs == null ? [] : [...requiredInputs];
    let bytesAccum = utils_1.utils.transactionBytes(inputs, outputs, type);
    let inAccum = utils_1.utils.sumOrNaN(inputs);
    let cpfpAddFee = 0;
    const outAccum = utils_1.utils.sumOrNaN(outputs);
    const threshold = utils_1.utils.dustThreshold({ type });
    for (let i = 0; i < utxos.length; ++i) {
        const input = utxos[i];
        const inputBytes = utils_1.utils.inputBytes(input);
        let cpfpFee = 0;
        if (input.cpfp != null && input.cpfp.txEffectiveFeeRate < feeRate)
            cpfpFee = Math.ceil(input.cpfp.txVsize * (feeRate - input.cpfp.txEffectiveFeeRate));
        const fee = Math.ceil((feeRate * (bytesAccum + inputBytes)) + cpfpAddFee + cpfpFee);
        const inputValue = utils_1.utils.uintOrNaN(input.value);
        // would it waste value?
        if ((inAccum + inputValue) > (outAccum + fee + threshold))
            continue;
        bytesAccum += inputBytes;
        inAccum += inputValue;
        cpfpAddFee += cpfpFee;
        inputs.push(input);
        // go again?
        if (inAccum < outAccum + fee)
            continue;
        return utils_1.utils.finalize(inputs, outputs, feeRate, type, cpfpAddFee);
    }
    return { fee: (feeRate * bytesAccum) + cpfpAddFee };
}
exports.blackjack = blackjack;
