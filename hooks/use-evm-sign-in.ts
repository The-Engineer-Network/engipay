"use client"

import { useCallback, useState } from "react"
import { useSignMessage } from "wagmi"
import { apiPublicRequest, writeSessionToken } from "@/lib/api"
import { buildSignInMessage } from "@/lib/siwe"

interface NonceResponse {
  nonce: string
}

interface VerifyResponse {
  token: string
  user_id: string
}

/**
 * Signs the connected Ethereum wallet in to EngiPay: get a nonce, have the
 * wallet sign a message that carries it, exchange the signature for a session
 * token and keep the token.
 */
export function useEvmSignIn() {
  const { signMessageAsync } = useSignMessage()
  const [isSigning, setIsSigning] = useState(false)

  const signIn = useCallback(
    async (address: string) => {
      setIsSigning(true)
      try {
        const nonce = await apiPublicRequest<NonceResponse>("/v1/auth/nonce", { method: "POST" })
        if (!nonce) throw new Error("The API did not return a sign-in nonce.")

        const message = buildSignInMessage({ address, nonce: nonce.nonce, issuedAt: new Date() })
        const signature = await signMessageAsync({ message })

        const session = await apiPublicRequest<VerifyResponse>("/v1/auth/verify-evm", {
          method: "POST",
          body: JSON.stringify({ message, signature, address }),
        })
        if (!session) throw new Error("The API did not return a session.")

        writeSessionToken(session.token)
        return session
      } finally {
        setIsSigning(false)
      }
    },
    [signMessageAsync]
  )

  return { signIn, isSigning }
}
