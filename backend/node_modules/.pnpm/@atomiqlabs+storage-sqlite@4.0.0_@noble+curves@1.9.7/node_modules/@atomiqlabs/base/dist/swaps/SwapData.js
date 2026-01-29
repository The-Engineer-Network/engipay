"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SwapData = void 0;
class SwapData {
    static deserialize(data) {
        const deserializer = SwapData.deserializers[data.type];
        if (deserializer != null) {
            return new deserializer(data);
        }
        throw new Error(`No deserializer found for swap data type: ${data.type}`);
    }
    getHTLCHashHint() {
        return null;
    }
    hasSuccessAction() {
        return false;
    }
}
exports.SwapData = SwapData;
SwapData.deserializers = {};
