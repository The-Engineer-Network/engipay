export declare enum MessageType {
    SWAP_CLAIM_WITNESS = 0
}
export declare abstract class Message {
    abstract type: MessageType;
    static deserializers: {
        [type: number]: (obj: any) => Message;
    };
    serialize(): any;
    static deserialize(message: any): Message;
}
