/**
 * Stellar wallets on phones, over WalletConnect v2.
 *
 * Mobile wallets (Freighter mobile, LOBSTR and others) are separate apps, so a
 * mobile browser cannot see them the way a desktop browser sees the Freighter
 * extension. They connect through WalletConnect instead: EngiPay shows a code
 * or opens the wallet app, the user approves, and signing requests travel over
 * WalletConnect's relay. The key never leaves the wallet.
 *
 * Details confirmed against Freighter mobile's source: namespace `stellar`,
 * chains `stellar:pubnet` and `stellar:testnet`, `stellar_signXDR` takes
 * `{ xdr }` and returns `{ signedXDR }`, and the app opens with
 * `freighterwallet://wc?uri=…`.
 */

import type SignClient from "@walletconnect/sign-client"
import type { SessionTypes } from "@walletconnect/types"
import { stellarNetwork } from "@/lib/stellar"

export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? ""

/** WalletConnect's name for the Stellar network EngiPay is on. */
export const STELLAR_WC_CHAIN = `stellar:${stellarNetwork.name === "mainnet" ? "pubnet" : "testnet"}`

const METHODS = ["stellar_signXDR"]

/** Freighter mobile's app link. */
export function freighterMobileLink(uri?: string): string {
  return uri ? `freighterwallet://wc?uri=${encodeURIComponent(uri)}` : "freighterwallet://"
}

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

let clientPromise: Promise<SignClient> | null = null

/**
 * One client per page, with its own storage prefix so it never collides with
 * the WalletConnect client wagmi runs for EVM wallets.
 */
export function getStellarSignClient(): Promise<SignClient> {
  if (!WALLETCONNECT_PROJECT_ID) {
    return Promise.reject(
      new Error("Mobile wallets need WalletConnect, which is not set up on this site yet.")
    )
  }
  if (!clientPromise) {
    clientPromise = import("@walletconnect/sign-client")
      .then(({ default: Client }) =>
        Client.init({
          projectId: WALLETCONNECT_PROJECT_ID,
          customStoragePrefix: "engipay-stellar",
          metadata: {
            name: "EngiPay",
            description: "Pay and get paid in crypto from Nigeria",
            url: window.location.origin,
            icons: [`${window.location.origin}/engipay.png`],
          },
        })
      )
      .catch((error) => {
        clientPromise = null
        throw error
      })
  }
  return clientPromise
}

export interface StellarWcSession {
  topic: string
  address: string
  /** The chain the wallet approved, e.g. "stellar:testnet". */
  chain: string
  walletName: string
}

/** Reads the Stellar account out of an approved session. */
export function sessionToAccount(session: SessionTypes.Struct): StellarWcSession | null {
  const account = session.namespaces.stellar?.accounts?.[0]
  if (!account) return null
  // CAIP-10: "stellar:testnet:G…"
  const lastColon = account.lastIndexOf(":")
  return {
    topic: session.topic,
    address: account.slice(lastColon + 1),
    chain: account.slice(0, lastColon),
    walletName: session.peer.metadata.name || "Stellar wallet",
  }
}

/** The most recent live Stellar session, restored after a page reload. */
export async function restoreStellarSession(): Promise<StellarWcSession | null> {
  const client = await getStellarSignClient()
  const now = Math.floor(Date.now() / 1000)
  const live = client.session
    .getAll()
    .filter((session) => session.namespaces.stellar && session.expiry > now)
    .sort((a, b) => b.expiry - a.expiry)
  return live.length ? sessionToAccount(live[0]) : null
}

/**
 * Starts a connection. Returns the pairing URI to show as a QR code or open in
 * a wallet app, and a promise that resolves once the wallet approves.
 */
export async function startStellarConnection(): Promise<{
  uri: string
  approval: Promise<StellarWcSession>
}> {
  const client = await getStellarSignClient()
  const { uri, approval } = await client.connect({
    optionalNamespaces: {
      stellar: {
        methods: METHODS,
        chains: [STELLAR_WC_CHAIN],
        events: ["accountsChanged"],
      },
    },
  })
  if (!uri) throw new Error("WalletConnect did not return a connection link.")

  return {
    uri,
    approval: approval().then((session) => {
      const account = sessionToAccount(session)
      if (!account) throw new Error("The wallet did not share a Stellar account.")
      return account
    }),
  }
}

/** Asks the connected wallet to sign a transaction. Resolves with signed XDR. */
export async function signWithWalletConnect(session: StellarWcSession, xdr: string): Promise<string> {
  const client = await getStellarSignClient()
  const request = client.request<{ signedXDR: string }>({
    topic: session.topic,
    chainId: session.chain,
    request: { method: "stellar_signXDR", params: { xdr } },
  })

  // On a phone, bring the wallet to the front so the request is seen.
  if (isMobileDevice() && /freighter/i.test(session.walletName)) {
    window.location.href = freighterMobileLink()
  }

  const result = await request
  if (!result?.signedXDR) throw new Error("The wallet did not return a signed transaction.")
  return result.signedXDR
}

export async function disconnectWalletConnect(session: StellarWcSession): Promise<void> {
  try {
    const client = await getStellarSignClient()
    await client.disconnect({
      topic: session.topic,
      reason: { code: 6000, message: "User disconnected" },
    })
  } catch {
    // Already gone on the wallet's side; forgetting it locally is enough.
  }
}
