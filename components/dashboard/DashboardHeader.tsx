"use client"

import Link from "next/link"
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton"

/**
 * The wallet control opens EngiPay's own wallet sheet when disconnected, and
 * RainbowKit's account panel once connected.
 */
export function DashboardHeader() {
  return (
    <header className="border-b border-border">
      <div className="container flex items-center justify-between gap-4 py-3">
        <Link href="/" className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80">
          <img
            src="/engipay.png"
            alt="EngiPay"
            className="h-8 w-8 object-contain brightness-0 invert"
          />
          <span className="text-lg font-semibold">EngiPay</span>
        </Link>

        <ConnectWalletButton />
      </div>
    </header>
  )
}
