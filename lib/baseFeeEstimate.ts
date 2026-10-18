/**
 * Helpers for showing and reserving the network fee on Base sends.
 * All values are wei as bigint; nothing here uses floating point.
 */

/** Gas of a plain ETH transfer, used until a real estimate arrives. */
export const FALLBACK_NATIVE_GAS = 21_000n
/** Generous gas for an ERC-20 transfer, used until a real estimate arrives. */
export const FALLBACK_TOKEN_GAS = 65_000n

/** Worst-case fee in wei: gas units times the max fee per gas. */
export function estimateFeeWei(gas: bigint, maxFeePerGas: bigint): bigint {
  return gas * maxFeePerGas
}

/** The most ETH that can be sent while keeping the fee. Never negative. */
export function maxNativeSendable(balanceWei: bigint, feeWei: bigint): bigint {
  return balanceWei > feeWei ? balanceWei - feeWei : 0n
}

export type FeeWarning = "native-short" | "token-needs-eth" | null

/**
 * Warns when the ETH balance cannot pay the fee. For ETH the amount plus the
 * fee must fit in the balance; for tokens the fee alone must.
 */
export function feeWarning(options: {
  isNative: boolean
  amountWei: bigint
  ethBalanceWei: bigint
  feeWei: bigint
}): FeeWarning {
  const { isNative, amountWei, ethBalanceWei, feeWei } = options
  if (isNative) return amountWei + feeWei > ethBalanceWei ? "native-short" : null
  return feeWei > ethBalanceWei ? "token-needs-eth" : null
}
