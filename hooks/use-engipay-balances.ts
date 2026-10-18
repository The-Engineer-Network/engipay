"use client"

import { useCallback, useEffect, useState } from "react"

/** One asset entry from GET /v1/balances. */
export interface EngiPayAssetBalance {
  /** e.g. "USDC", "ETH", "XLM", "BTC" */
  asset: string
  /** Decimal string from the API – never convert through Number. */
  available: string
  /** Amount locked in pending withdrawals / holds. */
  held: string
}

interface UseEngiPayBalancesResult {
  balances: EngiPayAssetBalance[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

/**
 * Fetches custodial balances from the EngiPay backend (GET /v1/balances).
 *
 * The hook requires an authenticated session JWT stored in localStorage
 * under "engipay-token". When no token is present it skips the fetch and
 * returns an empty list so unauthenticated pages stay fast.
 */
export function useEngiPayBalances(): UseEngiPayBalancesResult {
  const [balances, setBalances] = useState<EngiPayAssetBalance[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false

    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null

    // No session → nothing to fetch.
    if (!token) return

    setIsLoading(true)
    setError(null)

    fetch("/api/v1/balances", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<{ balances: EngiPayAssetBalance[] }>
      })
      .then((data) => {
        if (!cancelled) {
          setBalances(data.balances ?? [])
          setIsLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load balances")
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [tick])

  return { balances, isLoading, error, refetch }
}
