
export enum MessageType {
    SWAP_CLAIM_WITNESS = 0,

}

export abstract class Message {

    abstract type: MessageType;

    static deserializers: {[type: number]: (obj: any) => Message} = {};

    serialize(): any {
        return {
            type: this.type
        }
    }

    static deserialize(message: any): Message {
        const deserializer = Message.deserializers[message.type];
        if(deserializer==null) throw new Error("Unknown message type " + message.type);
        return deserializer(message);
    }

}
