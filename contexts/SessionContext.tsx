"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { readSessionToken } from "@/lib/api"

interface SessionContextValue {
  signedIn: boolean
  signIn: (token: string) => void
  signOut: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    setSignedIn(Boolean(readSessionToken()))
  }, [])

  const signIn = useCallback((token: string) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("engipay-token", token)
    }
    setSignedIn(true)
  }, [])

  const signOut = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("engipay-token")
    }
    setSignedIn(false)
  }, [])

  const value = useMemo<SessionContextValue>(
    () => ({ signedIn, signIn, signOut }),
    [signedIn, signIn, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) {
    throw new Error("useSession must be used within a SessionProvider")
  }
  return ctx
}
