import { fromMinorUnits, getAssetDecimals } from "./pos.ts"

export type PaymentRequestView = "open" | "partially_paid" | "paid" | "expired" | "cancelled"

/** Format a minor-unit integer string for display, without floating point. */
export function formatRequestAmount(minor: string, asset: string): string {
  try {
    return fromMinorUnits(BigInt(minor), getAssetDecimals(asset, "stellar"))
  } catch {
    return minor
  }
}

/** Map the API status (plus the clock) to a display state. */
export function resolveRequestView(
  status: string,
  expiresAt: string,
  now: number = Date.now()
): PaymentRequestView {
  if (status === "paid") return "paid"
  if (status === "cancelled") return "cancelled"
  if (status === "expired") return "expired"
  if (Date.parse(expiresAt) < now) return "expired"
  return status === "partially_paid" ? "partially_paid" : "open"
}

/** URI encoded in the QR code; mirrors the format the API issues. */
export function buildRequestUri(id: string, asset: string, amountMinor: string): string {
  return `engipay:${id}?asset=${encodeURIComponent(asset)}&amount=${amountMinor}`
}
