"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, X } from "lucide-react"
import { ACCOUNT_FROZEN_EVENT, isAccountFrozenResponse } from "@/lib/api-client"

/**
 * Stays visible after any authenticated API call reports account_frozen so the
 * user understands why account actions are unavailable.
 */
export function AccountFrozenBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showBanner = () => setVisible(true)
    const originalFetch = window.fetch
    const monitoredFetch: typeof window.fetch = async (...args) => {
      const response = await originalFetch(...args)
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null)
        if (isAccountFrozenResponse(body)) showBanner()
      }
      return response
    }

    window.addEventListener(ACCOUNT_FROZEN_EVENT, showBanner)
    window.fetch = monitoredFetch

    return () => {
      window.removeEventListener(ACCOUNT_FROZEN_EVENT, showBanner)
      if (window.fetch === monitoredFetch) window.fetch = originalFetch
    }
  }, [])

  if (!visible) return null

  return (
    <div
      role="alert"
      className="border-b border-warning/30 bg-warning/10 text-foreground"
    >
      <div className="container flex items-start gap-3 py-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        <p className="flex-1 leading-6">
          <strong className="font-semibold">Your account is frozen.</strong>{" "}
          Account actions are temporarily unavailable. Please contact support through the{" "}
          <Link href="/help" className="font-medium text-warning underline underline-offset-2">
            Help centre
          </Link>{" "}
          for assistance.
        </p>
        <button
          type="button"
          onClick={() => setVisible(false)}
          className="rounded-md p-1 text-warning transition-colors hover:bg-warning/20"
          aria-label="Dismiss account frozen message"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
