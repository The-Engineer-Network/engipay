/**
 * Interface for swaps which require a user to send funds to a specific address
 */
export interface IAddressSwap {

    getAddress(): string;
    getHyperlink(): string;

}
