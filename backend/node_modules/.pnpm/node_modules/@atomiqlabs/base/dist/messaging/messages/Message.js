"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = exports.MessageType = void 0;
var MessageType;
(function (MessageType) {
    MessageType[MessageType["SWAP_CLAIM_WITNESS"] = 0] = "SWAP_CLAIM_WITNESS";
})(MessageType = exports.MessageType || (exports.MessageType = {}));
class Message {
    serialize() {
        return {
            type: this.type
        };
    }
    static deserialize(message) {
        const deserializer = Message.deserializers[message.type];
        if (deserializer == null)
            throw new Error("Unknown message type " + message.type);
        return deserializer(message);
    }
}
exports.Message = Message;
Message.deserializers = {};
