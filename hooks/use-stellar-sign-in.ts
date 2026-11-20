"use client"

import { useCallback, useState } from "react"
import { apiPublicRequest, writeSessionToken } from "@/lib/api"
import { buildSignInMessage } from "@/lib/siwe"

interface NonceResponse {
  nonce: string
}

interface VerifyResponse {
  token: string
  user_id: string
}

/** Freighter's signTransaction API is used; we ask it to sign a plain text message. */
type SignMessageFn = (message: string) => Promise<string>

/**
 * Signs a Stellar wallet in to EngiPay: get a nonce, ask the wallet to sign a
 * message that carries it, and exchange the signature for a session token.
 *
 * Pass `signMessage` as a thin wrapper over whichever signing method the
 * wallet exposes (Freighter or WalletConnect).
 */
export function useStellarSignIn() {
  const [isSigning, setIsSigning] = useState(false)

  const signIn = useCallback(async (address: string, signMessage: SignMessageFn) => {
    setIsSigning(true)
    try {
      const nonce = await apiPublicRequest<NonceResponse>("/v1/auth/nonce", { method: "POST" })
      if (!nonce) throw new Error("The API did not return a sign-in nonce.")

      const message = buildSignInMessage({ address, nonce: nonce.nonce, issuedAt: new Date() })
      const signature = await signMessage(message)

      const session = await apiPublicRequest<VerifyResponse>("/v1/auth/verify-stellar", {
        method: "POST",
        body: JSON.stringify({ address, message, signature }),
      })
      if (!session) throw new Error("The API did not return a session.")

      writeSessionToken(session.token)
      return session
    } finally {
      setIsSigning(false)
    }
  }, [])

  return { signIn, isSigning }
}
