"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.accumulative = void 0;
const utils_1 = require("./utils");
const Utils_1 = require("../../utils/Utils");
const logger = (0, Utils_1.getLogger)("CoinSelect: ");
// add inputs until we reach or surpass the target value (or deplete)
// worst-case: O(n)
function accumulative(utxos, outputs, feeRate, type, requiredInputs) {
    if (!isFinite(utils_1.utils.uintOrNaN(feeRate)))
        return null;
    const inputs = requiredInputs == null ? [] : [...requiredInputs];
    let bytesAccum = utils_1.utils.transactionBytes(inputs, outputs, type);
    let fee = feeRate * bytesAccum;
    let cpfpAddFee = 0;
    let inAccum = utils_1.utils.sumOrNaN(inputs);
    const outAccum = utils_1.utils.sumOrNaN(outputs);
    logger.debug("accumulative(): total output: ", outAccum);
    for (let i = 0; i < utxos.length; ++i) {
        const utxo = utxos[i];
        const utxoBytes = utils_1.utils.inputBytes(utxo);
        const utxoFee = feeRate * utxoBytes;
        const utxoValue = utils_1.utils.uintOrNaN(utxo.value);
        let cpfpFee = 0;
        if (utxo.cpfp != null && utxo.cpfp.txEffectiveFeeRate < feeRate)
            cpfpFee = Math.ceil(utxo.cpfp.txVsize * (feeRate - utxo.cpfp.txEffectiveFeeRate));
        // skip detrimental input
        if (utxoFee + cpfpFee > utxo.value) {
            logger.debug("accumulative(" + i + "): Skipping detrimental output, cpfpFee: " + cpfpFee + " utxoFee: " + utxoFee + " value: " + utxo.value);
            if (i === utxos.length - 1)
                return { fee: (feeRate * (bytesAccum + utxoBytes)) + cpfpAddFee + cpfpFee };
            continue;
        }
        bytesAccum += utxoBytes;
        inAccum += utxoValue;
        cpfpAddFee += cpfpFee;
        inputs.push(utxo);
        fee = Math.ceil((feeRate * bytesAccum) + cpfpAddFee);
        logger.debug("accumulative(" + i + "): total fee: ", fee);
        logger.debug("accumulative(" + i + "): input value: ", inAccum);
        logger.debug("accumulative(" + i + "): cpfpAddFee: ", cpfpAddFee);
        // go again?
        if (inAccum < outAccum + fee)
            continue;
        logger.debug("accumulative(" + i + "): Finalizing transaction, inputs: ", inputs);
        logger.debug("accumulative(" + i + "): Finalizing transaction, outputs: ", outputs);
        logger.debug("accumulative(" + i + "): Finalizing transaction, feeRate: ", feeRate);
        return utils_1.utils.finalize(inputs, outputs, feeRate, type, cpfpAddFee);
    }
    return { fee };
}
exports.accumulative = accumulative;
