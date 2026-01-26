"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimHandlersList = void 0;
const HashlockClaimHandler_1 = require("./HashlockClaimHandler");
const BitcoinTxIdClaimHandler_1 = require("./btc/BitcoinTxIdClaimHandler");
const BitcoinOutputClaimHandler_1 = require("./btc/BitcoinOutputClaimHandler");
const BitcoinNoncedOutputClaimHandler_1 = require("./btc/BitcoinNoncedOutputClaimHandler");
exports.claimHandlersList = [
    HashlockClaimHandler_1.HashlockClaimHandler,
    BitcoinTxIdClaimHandler_1.BitcoinTxIdClaimHandler,
    BitcoinOutputClaimHandler_1.BitcoinOutputClaimHandler,
    BitcoinNoncedOutputClaimHandler_1.BitcoinNoncedOutputClaimHandler
];
