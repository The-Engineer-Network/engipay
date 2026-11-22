"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"

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

interface TransactionPage {
  items: EngiPayTransaction[]
  /** Pass as `cursor` param in the next request to get the next page. */
  next_cursor: string | null
}

interface UseEngiPayTransactionsResult {
  transactions: EngiPayTransaction[]
  isLoading: boolean
  isLoadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refetch: () => void
}

interface TransactionFilters {
  kind?: string
  startDate?: string
  endDate?: string
}

/**
 * Fetches the authenticated user's transaction history from the EngiPay
 * backend (GET /v1/transactions) with cursor-based pagination.
 *
 * `limit` controls how many items are fetched per page.
 * Pass `maxItems` to cap the list (useful for the dashboard preview).
 * Pass `filters` to filter by kind and date range.
 */
export function useEngiPayTransactions(options?: {
  limit?: number
  maxItems?: number
  filters?: TransactionFilters
}): UseEngiPayTransactionsResult {
  const limit = options?.limit ?? 20
  const maxItems = options?.maxItems
  const filters = options?.filters

  const [transactions, setTransactions] = useState<EngiPayTransaction[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetTick, setResetTick] = useState(0)

  /** Reset to the first page. */
  const refetch = useCallback(() => {
    setTransactions([])
    setCursor(null)
    setHasMore(false)
    setResetTick((n) => n + 1)
  }, [])

  /** Fetch the first page whenever the component mounts or is reset. */
  useEffect(() => {
    let cancelled = false

    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null
    if (!token) return

    setIsLoading(true)
    setError(null)

    apiClient
      .getTransactions({ limit, filters }, token)
      .then((page: TransactionPage) => {
        if (cancelled) return
        const items = maxItems ? page.items.slice(0, maxItems) : page.items
        setTransactions(items)
        setCursor(page.next_cursor)
        setHasMore(
          page.next_cursor !== null && (!maxItems || items.length < maxItems)
        )
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load transactions")
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetTick, filters?.kind, filters?.startDate, filters?.endDate])

  /** Append the next page of results. */
  const loadMore = useCallback(() => {
    if (!cursor || isLoadingMore) return

    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null
    if (!token) return

    setIsLoadingMore(true)

    apiClient
      .getTransactions({ limit, cursor, filters }, token)
      .then((page: TransactionPage) => {
        setTransactions((prev) => {
          const next = [...prev, ...page.items]
          return maxItems ? next.slice(0, maxItems) : next
        })
        setCursor(page.next_cursor)
        setHasMore(page.next_cursor !== null)
        setIsLoadingMore(false)
      })
      .catch(() => {
        setIsLoadingMore(false)
      })
  }, [cursor, isLoadingMore, limit, maxItems, filters])

  return { transactions, isLoading, isLoadingMore, error, hasMore, loadMore, refetch }
}
