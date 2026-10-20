/** A priced buy, as POST /v1/buy/quotes returns it. Money is integer strings. */
export interface BuyQuote {
  id: string
  asset: string
  /** Naira paid, in kobo. */
  naira_kobo: string
  /** Fee taken from the Naira, in kobo. */
  fee_kobo: string
  /** Asset the user receives, as a fixed-point decimal. */
  receive: string
  receive_decimals: number
  /** Kobo per whole unit of the asset. */
  kobo_per_unit: string
  /** RFC 3339 instant after which the quote is void. */
  expires_at: string
}

/** Formats kobo as Naira with two decimals: "5000" -> "₦50.00", "500000" -> "₦5,000.00". */
export function formatNaira(kobo: string): string {
  const naira = Number(kobo) / 100
  return `₦${naira.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Formats the quote's rate: "₦1,500.00 per USDC". */
export function formatRate(quote: BuyQuote): string {
  return `${formatNaira(quote.kobo_per_unit)} per ${quote.asset}`
}

/** Whole seconds left on a quote at `nowMs`. Zero once it has lapsed. */
export function secondsLeft(expiresAt: string, nowMs: number): number {
  const expiresMs = Date.parse(expiresAt)
  if (Number.isNaN(expiresMs)) return 0
  return Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
}

/** A quote is live until its expiry instant; after that it cannot become an order. */
export function isQuoteLive(expiresAt: string, nowMs: number): boolean {
  return secondsLeft(expiresAt, nowMs) > 0
}
