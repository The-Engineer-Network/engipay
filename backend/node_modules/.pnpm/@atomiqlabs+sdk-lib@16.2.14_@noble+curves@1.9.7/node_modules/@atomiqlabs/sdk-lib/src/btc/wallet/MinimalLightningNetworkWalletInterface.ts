/**
 * A type with minimum possible required functionality to be usable with lightning network swaps
 */
export type MinimalLightningNetworkWalletInterface = {
    payInvoice: (bolt11PaymentRequest: string) => Promise<string>
}
