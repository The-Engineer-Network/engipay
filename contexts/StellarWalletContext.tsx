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
import {
  STELLAR_WC_CHAIN,
  WALLETCONNECT_PROJECT_ID,
  type StellarWcSession,
} from "@/lib/stellar-walletconnect"

/** Remembers that the user connected the Freighter extension, so a reload reconnects quietly. */
const CONNECTED_KEY = "engipay-stellar-connected"

export type StellarConnectResult = "connected" | "not-installed" | "cancelled"

export interface StellarSendInput {
  destination: string
  amount: string
  asset: StellarAssetCode
  memo?: StellarMemo
}

/** How the Stellar account is connected. */
export type StellarConnection = { kind: "extension" } | { kind: "walletconnect"; session: StellarWcSession }

export interface PendingWalletConnect {
  /** Pairing link: shown as a QR code, or opened in a wallet app on a phone. */
  uri: string
  /** Resolves once the wallet approves. */
  approval: Promise<void>
}

interface StellarWalletContextType {
  stellarAddress: string | null
  isStellarConnected: boolean
  /** "Freighter", "LOBSTR", …: the wallet on the other end. */
  stellarWalletName: string | null
  /** Whether the Freighter browser extension is present. Never true on phones. */
  hasFreighter: boolean
  /** False when the site has no WalletConnect project id, so phone wallets cannot connect. */
  walletConnectAvailable: boolean
  /**
   * Set when the wallet is on a different Stellar network than EngiPay. Sending
   * is blocked until it matches: a testnet payment signed for mainnet is invalid.
   */
  networkMismatch: string | null
  balances: StellarBalances | undefined
  isLoadingBalances: boolean
  /** Connects the Freighter browser extension. */
  connectStellar: () => Promise<StellarConnectResult>
  /** Starts a WalletConnect connection for mobile and other Stellar wallets. */
  connectStellarWalletConnect: () => Promise<PendingWalletConnect>
  disconnectStellar: () => void
  refetchStellarBalances: () => void
  /** Builds, signs in the wallet and submits. Resolves with the transaction hash. */
  sendStellarPayment: (input: StellarSendInput) => Promise<{ hash: string; createsAccount: boolean }>
}

const StellarWalletContext = createContext<StellarWalletContextType | undefined>(undefined)

export function useStellarWallet() {
  const context = useContext(StellarWalletContext)
  if (!context) throw new Error("useStellarWallet must be used within a StellarWalletProvider")
  return context
}

/** Wallet code is loaded on demand: it only runs in the browser. */
const freighter = () => import("@stellar/freighter-api")
const walletConnect = () => import("@/lib/stellar-walletconnect")

function remember(connected: boolean) {
  try {
    if (connected) localStorage.setItem(CONNECTED_KEY, "true")
    else localStorage.removeItem(CONNECTED_KEY)
  } catch {
    // Private mode: the user reconnects after a reload.
  }
}

function mismatchMessage(walletNetwork: string) {
  return `Your wallet is set to ${walletNetwork}. Switch it to ${stellarNetwork.label} to send.`
}

/**
 * The Stellar side of the wallet. On desktop, the Freighter extension. On
 * phones, and for LOBSTR and other wallets, WalletConnect. Either way the key
 * never leaves the wallet: EngiPay builds the payment, the wallet signs it.
 */
export function StellarWalletProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [stellarAddress, setStellarAddress] = useState<string | null>(null)
  const [connection, setConnection] = useState<StellarConnection | null>(null)
  const [hasFreighter, setHasFreighter] = useState(false)
  const [networkMismatch, setNetworkMismatch] = useState<string | null>(null)

  const checkExtensionNetwork = useCallback(async () => {
    const api = await freighter()
    const details = await api.getNetworkDetails()
    setNetworkMismatch(
      details.error || details.networkPassphrase === stellarNetwork.passphrase
        ? null
        : mismatchMessage(details.network || "another network")
    )
  }, [])

  const adoptSession = useCallback((session: StellarWcSession) => {
    setStellarAddress(session.address)
    setConnection({ kind: "walletconnect", session })
    setNetworkMismatch(session.chain === STELLAR_WC_CHAIN ? null : mismatchMessage(session.chain))
  }, [])

  // Detect the extension, and restore a previous connection quietly.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const api = await freighter()
        const { isConnected } = await api.isConnected()
        if (cancelled) return
        setHasFreighter(isConnected)
        if (isConnected && localStorage.getItem(CONNECTED_KEY) === "true") {
          const { address } = await api.getAddress()
          if (!cancelled && address) {
            setStellarAddress(address)
            setConnection({ kind: "extension" })
            await checkExtensionNetwork()
            return
          }
        }
      } catch {
        // No extension, or storage blocked.
      }

      if (!WALLETCONNECT_PROJECT_ID) return
      try {
        const { restoreStellarSession } = await walletConnect()
        const session = await restoreStellarSession()
        if (!cancelled && session) adoptSession(session)
      } catch {
        // WalletConnect unreachable: the user can connect again.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adoptSession, checkExtensionNetwork])

  // Forget a WalletConnect session the wallet ended from its side.
  useEffect(() => {
    if (connection?.kind !== "walletconnect") return
    let detach: (() => void) | undefined
    walletConnect()
      .then(({ getStellarSignClient }) => getStellarSignClient())
      .then((client) => {
        const onDelete = ({ topic }: { topic: string }) => {
          if (topic === connection.session.topic) {
            setStellarAddress(null)
            setConnection(null)
            setNetworkMismatch(null)
          }
        }
        client.on("session_delete", onDelete)
        client.on("session_expire", onDelete)
        detach = () => {
          client.off("session_delete", onDelete)
          client.off("session_expire", onDelete)
        }
      })
      .catch(() => {})
    return () => detach?.()
  }, [connection])

  const connectStellar = useCallback(async (): Promise<StellarConnectResult> => {
    const api = await freighter()
    const { isConnected } = await api.isConnected()
    if (!isConnected) return "not-installed"
    setHasFreighter(true)

    const { address, error } = await api.requestAccess()
    if (error || !address) return "cancelled"

    setStellarAddress(address)
    setConnection({ kind: "extension" })
    remember(true)
    await checkExtensionNetwork()
    return "connected"
  }, [checkExtensionNetwork])

  const connectStellarWalletConnect = useCallback(async (): Promise<PendingWalletConnect> => {
    const { startStellarConnection } = await walletConnect()
    const { uri, approval } = await startStellarConnection()
    return {
      uri,
      approval: approval.then((session) => {
        remember(false)
        adoptSession(session)
      }),
    }
  }, [adoptSession])

  const disconnectStellar = useCallback(() => {
    if (connection?.kind === "walletconnect") {
      const { session } = connection
      void walletConnect().then(({ disconnectWalletConnect }) => disconnectWalletConnect(session))
    }
    // Freighter's extension has no "disconnect"; EngiPay forgets the account.
    setStellarAddress(null)
    setConnection(null)
    setNetworkMismatch(null)
    remember(false)
  }, [connection])

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
      if (!stellarAddress || !connection) throw new Error("Connect a Stellar wallet to send.")

      const { buildStellarPayment } = await import("@/lib/stellar-tx")
      let signedXdr: string

      if (connection.kind === "extension") {
        await checkExtensionNetwork()
        const api = await freighter()
        const details = await api.getNetworkDetails()
        if (!details.error && details.networkPassphrase !== stellarNetwork.passphrase) {
          throw new Error(`Switch Freighter to ${stellarNetwork.label}, then try again.`)
        }
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
        signedXdr = signed.signedTxXdr
        const hash = await submitStellarTransaction(signedXdr)
        refetchStellarBalances()
        return { hash, createsAccount: built.createsAccount }
      }

      if (connection.session.chain !== STELLAR_WC_CHAIN) {
        throw new Error(`Switch your wallet to ${stellarNetwork.label}, then connect again.`)
      }
      const built = await buildStellarPayment({ source: stellarAddress, ...input })
      const { signWithWalletConnect } = await walletConnect()
      try {
        signedXdr = await signWithWalletConnect(connection.session, built.xdr)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          /declin|reject|cancel|denied/i.test(message)
            ? `You declined the payment in ${connection.session.walletName}.`
            : `${connection.session.walletName} could not sign the payment. Open the app and try again.`
        )
      }
      const hash = await submitStellarTransaction(signedXdr)
      refetchStellarBalances()
      return { hash, createsAccount: built.createsAccount }
    },
    [checkExtensionNetwork, connection, refetchStellarBalances, stellarAddress]
  )

  const value = useMemo<StellarWalletContextType>(
    () => ({
      stellarAddress,
      isStellarConnected: Boolean(stellarAddress),
      stellarWalletName:
        connection?.kind === "walletconnect"
          ? connection.session.walletName
          : connection?.kind === "extension"
            ? "Freighter"
            : null,
      hasFreighter,
      walletConnectAvailable: Boolean(WALLETCONNECT_PROJECT_ID),
      networkMismatch,
      balances: balancesQuery.data,
      isLoadingBalances: balancesQuery.isLoading,
      connectStellar,
      connectStellarWalletConnect,
      disconnectStellar,
      refetchStellarBalances,
      sendStellarPayment,
    }),
    [
      stellarAddress,
      connection,
      hasFreighter,
      networkMismatch,
      balancesQuery.data,
      balancesQuery.isLoading,
      connectStellar,
      connectStellarWalletConnect,
      disconnectStellar,
      refetchStellarBalances,
      sendStellarPayment,
    ]
  )

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>
}
