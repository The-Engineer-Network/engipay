import { Buffer } from "buffer";
import { StarknetModule } from "../StarknetModule";
import { StarknetSigner } from "../../wallet/StarknetSigner";
import { StarknetType, TypedData } from "starknet";
import { StarknetChainInterface } from "../StarknetChainInterface";
export declare class StarknetSignatures extends StarknetModule {
    private readonly domain;
    constructor(root: StarknetChainInterface, domainName?: string);
    getTypedMessage(type: StarknetType[], typeName: string, message: object): TypedData;
    signTypedMessage(signer: StarknetSigner, type: StarknetType[], typeName: string, message: object): Promise<string>;
    isValidSignature(signature: string, address: string, type: StarknetType[], typeName: string, message: object): Promise<boolean>;
    /**
     * Produces a signature over the sha256 of a specified data Buffer, only works with providers which
     *  expose their private key (i.e. backend based, not browser wallet based)
     *
     * @param signer
     * @param data data to sign
     */
    getDataSignature(signer: StarknetSigner, data: Buffer): Promise<string>;
    /**
     * Checks whether a signature is a valid signature produced by the account over a data message (computes
     *  sha256 hash of the message)
     *
     * @param data signed data
     * @param signature data signature
     * @param address public key of the signer
     */
    isValidDataSignature(data: Buffer, signature: string, address: string): Promise<boolean>;
}
