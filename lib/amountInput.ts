/**
 * Parsing helpers for amount fields. Amounts stay decimal strings end to end,
 * never numbers, so no precision is lost before they reach a chain client.
 */

/** Decimal places each displayed asset supports. */
export const ASSET_DECIMALS: Record<string, number> = {
  ETH: 18,
  USDC: 6,
  XLM: 7,
  BTC: 8,
}

/** Used for an asset we do not know; the widest supported precision. */
export const DEFAULT_DECIMALS = 18

export function decimalsForAsset(symbol: string): number {
  return ASSET_DECIMALS[symbol] ?? DEFAULT_DECIMALS
}

/**
 * Cleans typed text into a valid partial amount: digits and at most one
 * separator (a comma counts as the separator), with the fraction cut to
 * `decimals` places. Returns the cleaned string, which may be "" or end in ".".
 */
export function sanitizeAmount(raw: string, decimals: number): string {
  const text = raw.replace(/,/g, ".").replace(/[^0-9.]/g, "")
  const dot = text.indexOf(".")
  if (dot === -1) return text
  const whole = text.slice(0, dot)
  const fraction = text.slice(dot + 1).replace(/\./g, "").slice(0, Math.max(0, decimals))
  if (decimals <= 0) return whole
  return `${whole}.${fraction}`
}

/** True when the string is a complete decimal greater than zero. */
export function isPositiveAmount(value: string): boolean {
  return /^(\d+\.?\d*|\.\d+)$/.test(value) && /[1-9]/.test(value)
}
