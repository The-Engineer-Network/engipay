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
import { buildSignInMessage } from "@/lib/siwe"
import { apiPublicRequest, writeSessionToken, clearSessionToken } from "@/lib/api"

/** Remembers that the user connected the Freighter extension, so a reload reconnects quietly. */
const CONNECTED_KEY = "engipay-stellar-connected"

export type StellarConnectResult = "connected" | "not-installed" | "cancelled"

export interface StellarSendInput {
  destination: string
  amount: string
  asset: StellarAssetCode
  memo?: StellarMemo
}

/**
 * A cross-asset payment: the sender spends `sendAsset`/`sendAmount` and the
 * recipient receives at least `destMin` of `destAsset`.  The quote comes from
 * Horizon path finding; `slippageBps` is the limit the user agreed to.
 */
export interface StellarPathSendInput {
  destination: string
  /** Asset the sender spends, e.g. "XLM". */
  sendAsset: StellarAssetCode
  /** Amount of `sendAsset` to spend, as a decimal string. */
  sendAmount: string
  /** Asset the recipient receives, e.g. "USDC". */
  destAsset: StellarAssetCode
  /** Minimum the recipient must receive, as a decimal string. */
  destMin: string
  /** Slippage tolerance in basis points that the user agreed to. */
  slippageBps: number
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
  /** True when a backend session has been established after the last connect. */
  isSignedIn: boolean
  /**
   * Non-null when the user declined the sign-in signature.  Show this as a
   * non-alarming toast or banner rather than an error.
   */
  signInDeclinedMessage: string | null
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
  /**
   * Builds, signs and submits a cross-asset path payment.  Resolves with the
   * transaction hash and what was actually sent and received.
   */
  sendStellarPathPayment: (input: StellarPathSendInput) => Promise<StellarPathSendResult>
}

/** What a path payment actually moved, as recorded in the ledger. */
export interface StellarPathSendResult {
  hash: string
  /** Asset and amount the sender spent. */
  sent: { asset: StellarAssetCode; amount: string }
  /** Asset and amount the recipient received. */
  received: { asset: StellarAssetCode; amount: string }
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

interface NonceResponse { nonce: string }
interface VerifyResponse { token: string; user_id: string }

/**
 * Requests a nonce, has the wallet sign a message, and exchanges the
 * signature for a session token.  Returns true on success and false if the
 * user declines — so callers can show a friendly message without throwing.
 */
async function signInWithStellar(
  address: string,
  signMessage: (msg: string) => Promise<string>
): Promise<boolean> {
  try {
    const nonce = await apiPublicRequest<NonceResponse>("/v1/auth/nonce", { method: "POST" })
    if (!nonce) return false
    const message = buildSignInMessage({ address, nonce: nonce.nonce, issuedAt: new Date() })
    const signature = await signMessage(message)
    const session = await apiPublicRequest<VerifyResponse>("/v1/auth/verify-stellar", {
      method: "POST",
      body: JSON.stringify({ address, message, signature }),
    })
    if (!session) return false
    writeSessionToken(session.token)
    return true
  } catch {
    return false
  }
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
  /** Whether the backend session was established after the last connect. */
  const [signedIn, setSignedIn] = useState(false)
  /** Non-blocking message shown when the user declines the sign-in signature. */
  const [signInDeclinedMessage, setSignInDeclinedMessage] = useState<string | null>(null)

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

    // Attempt backend sign-in.  The wallet signs a short human-readable message
    // that explains what is being signed.  Declining the signature is fine:
    // the user stays connected but the session features are unavailable.
    const signMessage = async (msg: string) => {
      const result = await api.signMessage(msg, { address })
      if (result.error || !result.signedMessage) {
        const m = result.error?.message ?? ""
        if (/declin|reject|cancel|denied/i.test(m)) throw new DOMException("User declined", "AbortError")
        throw new Error("Freighter could not sign the message.")
      }
      // signedMessage may be a Buffer (Freighter v3) or a string (v4).
      const signed = result.signedMessage
      return typeof signed === "string" ? signed : signed.toString("hex")
    }
    const ok = await signInWithStellar(address, signMessage).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      return /declin|reject|cancel|abort/i.test(message) ? "declined" : false
    })
    if (ok === "declined" || ok === false) {
      setSignedIn(false)
      setSignInDeclinedMessage(
        ok === "declined"
          ? "You declined the sign-in request. You're connected but some features need a signature."
          : null
      )
    } else {
      setSignedIn(true)
      setSignInDeclinedMessage(null)
    }

    return "connected"
  }, [checkExtensionNetwork])

  const connectStellarWalletConnect = useCallback(async (): Promise<PendingWalletConnect> => {
    const { startStellarConnection } = await walletConnect()
    const { uri, approval } = await startStellarConnection()
    return {
      uri,
      approval: approval.then(async (session) => {
        remember(false)
        adoptSession(session)

        // After the WalletConnect session is established, sign in to the
        // backend so the session token is available immediately.
        const signMessage = async (msg: string) => {
          const { signWithWalletConnect } = await walletConnect()
          return signWithWalletConnect(session, msg)
        }
        const ok = await signInWithStellar(session.address, signMessage).catch(() => false)
        if (ok) {
          setSignedIn(true)
          setSignInDeclinedMessage(null)
        } else {
          setSignedIn(false)
          setSignInDeclinedMessage(
            "You declined the sign-in request. You're connected but some features need a signature."
          )
        }
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
    setSignedIn(false)
    setSignInDeclinedMessage(null)
    clearSessionToken()
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

  const sendStellarPathPayment = useCallback(
    async (input: StellarPathSendInput): Promise<StellarPathSendResult> => {
      if (!stellarAddress || !connection) throw new Error("Connect a Stellar wallet to send.")

      const { buildStellarPathPayment } = await import("@/lib/stellar-tx")
      let signedXdr: string

      if (connection.kind === "extension") {
        await checkExtensionNetwork()
        const api = await freighter()
        const details = await api.getNetworkDetails()
        if (!details.error && details.networkPassphrase !== stellarNetwork.passphrase) {
          throw new Error(`Switch Freighter to ${stellarNetwork.label}, then try again.`)
        }
        const built = await buildStellarPathPayment({ source: stellarAddress, ...input })
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
        return {
          hash,
          sent: { asset: input.sendAsset, amount: input.sendAmount },
          received: { asset: input.destAsset, amount: built.destAmount },
        }
      }

      if (connection.session.chain !== STELLAR_WC_CHAIN) {
        throw new Error(`Switch your wallet to ${stellarNetwork.label}, then connect again.`)
      }
      const built = await buildStellarPathPayment({ source: stellarAddress, ...input })
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
      return {
        hash,
        sent: { asset: input.sendAsset, amount: input.sendAmount },
        received: { asset: input.destAsset, amount: built.destAmount },
      }
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
      isSignedIn: signedIn,
      signInDeclinedMessage,
      balances: balancesQuery.data,
      isLoadingBalances: balancesQuery.isLoading,
      connectStellar,
      connectStellarWalletConnect,
      disconnectStellar,
      refetchStellarBalances,
      sendStellarPayment,
      sendStellarPathPayment,
    }),
    [
      stellarAddress,
      connection,
      hasFreighter,
      networkMismatch,
      signedIn,
      signInDeclinedMessage,
      balancesQuery.data,
      balancesQuery.isLoading,
      connectStellar,
      connectStellarWalletConnect,
      disconnectStellar,
      refetchStellarBalances,
      sendStellarPayment,
      sendStellarPathPayment,
    ]
  )

  return <StellarWalletContext.Provider value={value}>{children}</StellarWalletContext.Provider>
}
