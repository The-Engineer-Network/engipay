"use client"

import { useCallback, useState } from "react"
import {
  requestStellarChallenge,
  verifyStellarChallenge,
  writeSessionToken,
} from "@/lib/api-client"

type SignTransactionFn = (transaction: string, networkPassphrase: string) => Promise<string>

/**
 * Signs a Stellar wallet in to EngiPay: get a SEP-10 challenge, ask the wallet
 * to sign its transaction XDR, and exchange the signed transaction for a
 * session token.
 *
 * Pass `signTransaction` as a thin wrapper over whichever signing method the
 * wallet exposes (Freighter or WalletConnect).
 */
export function useStellarSignIn() {
  const [isSigning, setIsSigning] = useState(false)

  const signIn = useCallback(async (address: string, signTransaction: SignTransactionFn) => {
    setIsSigning(true)
    try {
      const challenge = await requestStellarChallenge(address)
      const transaction = await signTransaction(
        challenge.transaction,
        challenge.network_passphrase
      )
      const session = await verifyStellarChallenge({ account: address, transaction })

      writeSessionToken(session.token)
      return session
    } finally {
      setIsSigning(false)
    }
  }, [])

  return { signIn, isSigning }
}
