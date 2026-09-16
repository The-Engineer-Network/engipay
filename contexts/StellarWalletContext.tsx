"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { StellarMemo } from "@/lib/payment-uri"
import {
  type StellarAssetCode,
  type StellarBalances,
  fetchStellarBalances,
  stellarNetwork,
  submitStellarTransaction,
} from "@/lib/stellar"

/** Remembers that the user connected Freighter, so a reload reconnects quietly. */
const CONNECTED_KEY = "engipay-stellar-connected"

export type StellarConnectResult = "connected" | "not-installed" | "cancelled"

export interface StellarSendInput {
  destination: string
  amount: string
  asset: StellarAssetCode
  memo?: StellarMemo
}

interface StellarWalletContextType {
  stellarAddress: string | null
  isStellarConnected: boolean
  /** Whether the Freighter extension is present in this browser. */
  hasFreighter: boolean
  /**
   * Set when Freighter is on a different Stellar network than EngiPay. Sending
   * is blocked until it matches: a testnet payment signed for mainnet is invalid.
   */
  networkMismatch: string | null
  balances: StellarBalances | undefined
  isLoadingBalances: boolean
  connectStellar: () => Promise<StellarConnectResult>
  disconnectStellar: () => void
  refetchStellarBalances: () => void
  /** Builds, signs in Freighter and submits. Resolves with the transaction hash. */
  sendStellarPayment: (input: StellarSendInput) => Promise<{ hash: string; createsAccount: boolean }>
}

const StellarWalletContext = createContext<StellarWalletContextType | undefined>(undefined)

export function useStellarWallet() {
  const context = useContext(StellarWalletContext)
  if (!context) throw new Error("useStellarWallet must be used within a StellarWalletProvider")
  return context
}

/** Freighter is loaded on demand: it only exists in the browser. */
const freighter = () => import("@stellar/freighter-api")

function remember(connected: boolean) {
  try {
    if (connected) localStorage.setItem(CONNECTED_KEY, "true")
    else localStorage.removeItem(CONNECTED_KEY)
  } catch {
    // Private mode: the user reconnects after a reload.
  }
}

/**
 * The Stellar side of the wallet, through Freighter, the Stellar Development
 * Foundation's wallet. The key never leaves Freighter: EngiPay builds the
 * payment, Freighter shows it and signs it.
 */
export function StellarWalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [stellarAddress, setStellarAddress] = useState<string | null>(null)
  const [hasFreighter, setHasFreighter] = useState(false)
  const [networkMismatch, setNetworkMismatch] = useState<string | null>(null)

  const checkNetwork = useCallback(async () => {
    const api = await freighter()
    const details = await api.getNetworkDetails()
    if (details.error || details.networkPassphrase === stellarNetwork.passphrase) {
      setNetworkMismatch(null)
    } else {
      setNetworkMismatch(
        `Freighter is set to ${details.network || "another network"}. Switch it to ${stellarNetwork.label} to send.`
      )
    }
  }, [])

  // Detect Freighter, and reconnect quietly if the user connected before.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const api = await freighter()
        const { isConnected } = await api.isConnected()
        if (cancelled) return
        setHasFreighter(isConnected)
        if (!isConnected || localStorage.getItem(CONNECTED_KEY) !== "true") return
        const { address } = await api.getAddress()
        if (!cancelled && address) {
          setStellarAddress(address)
          await checkNetwork()
        }
      } catch {
        // No extension, or storage blocked. Stellar simply stays disconnected.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [checkNetwork])

  const connectStellar = useCallback(async (): Promise<StellarConnectResult> => {
    const api = await freighter()
    const { isConnected } = await api.isConnected()
    if (!isConnected) return "not-installed"
    setHasFreighter(true)

    const { address, error } = await api.requestAccess()
    if (error || !address) return "cancelled"

    setStellarAddress(address)
    remember(true)
    await checkNetwork()
    return "connected"
  }, [checkNetwork])

  const disconnectStellar = useCallback(() => {
    // Freighter has no "disconnect"; EngiPay forgets the account instead.
    setStellarAddress(null)
    setNetworkMismatch(null)
    remember(false)
  }, [])

  const balancesQuery = useQuery({
    queryKey: ["stellar-balances", stellarNetwork.name, stellarAddress],
    queryFn: () => fetchStellarBalances(stellarAddress as string),
    enabled: Boolean(stellarAddress),
    refetchInterval: 15_000,
  })

  const refetchStellarBalances = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["stellar-balances"] })
  }, [queryClient])

  const sendStellarPayment = useCallback(
    async (input: StellarSendInput) => {
      if (!stellarAddress) throw new Error("Connect Freighter to send on Stellar.")
      await checkNetwork()
      const api = await freighter()
      const details = await api.getNetworkDetails()
      if (!details.error && details.networkPassphrase !== stellarNetwork.passphrase) {
        throw new Error(`Switch Freighter to ${stellarNetwork.label}, then try again.`)
      }

      const { buildStellarPayment } = await import("@/lib/stellar-tx")
      const built = await buildStellarPayment({ source: stellarAddress, ...input })

      const signed = await api.signTransaction(built.xdr, {
        networkPassphrase: stellarNetwork.passphrase,
        address: stellarAddress,
      })
      if (signed.error || !signed.signedTxXdr) {
        const message = signed.error?.message ?? ""
        throw new Error(
          /declin|reject|cancel|denied/i.test(message)
            ? "You declined the payment in Freighter."
            : "Freighter could not sign the payment."
        )
      }

      const hash = await submitStellarTransaction(signed.signedTxXdr)
      refetchStellarBalances()
      return { hash, createsAccount: built.createsAccount }
    },
    [checkNetwork, refetchStellarBalances, stellarAddress]
  )

  const value = useMemo<StellarWalletContextType>(
    () => ({
      stellarAddress,
      isStellarConnected: Boolean(stellarAddress),
      hasFreighter,
      networkMismatch,
      balances: balancesQuery.data,
      isLoadingBalances: balancesQuery.isLoading,
      connectStellar,
      disconnectStellar,
      refetchStellarBalances,
      sendStellarPayment,
    }),
    [
      stellarAddress,
      hasFreighter,
      networkMismatch,
      balancesQuery.data,
      balancesQuery.isLoading,
      connectStellar,
      disconnectStellar,
      refetchStellarBalances,
      sendStellarPayment,
    ]
  )

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>
}
