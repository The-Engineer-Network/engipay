"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapCommitStateType = void 0;
var SwapCommitStateType;
(function (SwapCommitStateType) {
    SwapCommitStateType[SwapCommitStateType["EXPIRED"] = 0] = "EXPIRED";
    SwapCommitStateType[SwapCommitStateType["NOT_COMMITED"] = 1] = "NOT_COMMITED";
    SwapCommitStateType[SwapCommitStateType["COMMITED"] = 2] = "COMMITED";
    SwapCommitStateType[SwapCommitStateType["PAID"] = 3] = "PAID";
    SwapCommitStateType[SwapCommitStateType["REFUNDABLE"] = 4] = "REFUNDABLE";
})(SwapCommitStateType = exports.SwapCommitStateType || (exports.SwapCommitStateType = {}));
