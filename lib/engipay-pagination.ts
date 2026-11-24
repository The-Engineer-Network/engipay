/**
 * Pure pagination helpers for the EngiPay transaction list.
 *
 * Keeping the page-merging rules here makes them testable without React and
 * lets useEngiPayTransactions stay a thin state wrapper around the API client.
 */

/** One transaction entry from GET /v1/transactions. */
export interface EngiPayTransaction {
  id: string
  /** e.g. "transfer", "deposit", "withdrawal", "conversion" */
  type: string
  /** "credit" = money came in, "debit" = money went out */
  direction: "credit" | "debit"
  amount: string
  asset: string
  /** ISO-8601 timestamp */
  created_at: string
  status: "completed" | "pending" | "failed"
  /** Present when the transaction was settled on-chain. */
  tx_hash?: string
  /** Human-readable counterpart label, e.g. "@alice" or "Bank withdrawal" */
  description?: string
  /** Transaction reference number */
  reference?: string
  /** Counterparty information (e.g., recipient tag or address) */
  counterparty?: string
}

/** A cursor-paginated page returned by GET /v1/transactions. */
export interface TransactionPage {
  items: EngiPayTransaction[]
  /** Pass as `cursor` param in the next request to get the next page. */
  next_cursor: string | null
}

/**
 * Append one page to the entries already loaded, capping the result at
 * `maxItems` when the caller asked for a preview-sized list.
 */
export function mergeTransactionItems(
  current: EngiPayTransaction[],
  incoming: EngiPayTransaction[],
  maxItems?: number
): EngiPayTransaction[] {
  const merged = [...current, ...incoming]
  return maxItems ? merged.slice(0, maxItems) : merged
}

/** Whether another page can be fetched after the first page was loaded. */
export function hasMoreAfterFirstPage(
  page: TransactionPage,
  maxItems?: number
): boolean {
  return page.next_cursor !== null && (!maxItems || page.items.length < maxItems)
}

/** Whether another page can be fetched after a `loadMore` response. */
export function hasMoreAfterNextPage(page: TransactionPage): boolean {
  return page.next_cursor !== null
}
