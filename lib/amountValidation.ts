/**
 * Validates a user-typed amount as a decimal string against a token's decimals
 * and a balance in base units. No floating point is involved anywhere.
 */

export type AmountCheck = { ok: true; units: bigint } | { ok: false; message: string }

export function validateSendAmount(
  amount: string,
  decimals: number,
  symbol: string,
  balanceUnits?: bigint
): AmountCheck {
  const text = amount.trim()
  if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) {
    return { ok: false, message: "Enter the amount as a plain number, such as 0.25." }
  }
  const [whole, fraction = ""] = text.split(".")
  if (fraction.length > decimals) {
    return {
      ok: false,
      message:
        decimals === 0
          ? `${symbol} cannot be split into decimals. Enter a whole number.`
          : `${symbol} supports at most ${decimals} decimal places.`,
    }
  }
  const units = BigInt((whole || "0") + fraction.padEnd(decimals, "0"))
  if (units <= 0n) {
    return { ok: false, message: "Enter an amount greater than zero." }
  }
  if (balanceUnits !== undefined && units > balanceUnits) {
    return { ok: false, message: `That is more than your ${symbol} balance.` }
  }
  return { ok: true, units }
}
