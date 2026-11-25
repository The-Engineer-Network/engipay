"use client"

import { useCallback, useEffect, useState } from "react"
import { apiClient } from "@/lib/api-client"
import {
  hasMoreAfterFirstPage,
  hasMoreAfterNextPage,
  mergeTransactionItems,
  type EngiPayTransaction,
  type TransactionPage,
} from "@/lib/engipay-pagination"

export type { EngiPayTransaction } from "@/lib/engipay-pagination"

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
        const items = mergeTransactionItems([], page.items, maxItems)
        setTransactions(items)
        setCursor(page.next_cursor)
        setHasMore(hasMoreAfterFirstPage(page, maxItems))
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
        setTransactions((prev) => mergeTransactionItems(prev, page.items, maxItems))
        setCursor(page.next_cursor)
        setHasMore(hasMoreAfterNextPage(page))
        setIsLoadingMore(false)
      })
      .catch(() => {
        setIsLoadingMore(false)
      })
  }, [cursor, isLoadingMore, limit, maxItems, filters])

  return { transactions, isLoading, isLoadingMore, error, hasMore, loadMore, refetch }
}
