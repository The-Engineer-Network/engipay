"use client"

import { useEffect, useState, type ReactNode } from "react"
import { DashboardHeader } from "@/components/dashboard/DashboardHeader"
import { AppNav } from "@/components/app/AppNav"
import { BottomNav } from "@/components/app/BottomNav"
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton"
import { useWallet } from "@/contexts/WalletContext"
import { Wallet } from "lucide-react"

/**
 * Shell for every signed-in screen: header, navigation, and a single wallet
 * guard so no page has to repeat it. Navigation is a top bar on desktop and a
 * bottom bar on phones.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { isConnected, isConnecting } = useWallet()
  const [mounted, setMounted] = useState(false)

  // The wallet state is only known in the browser, so render nothing that
  // depends on it until after hydration.
  useEffect(() => setMounted(true), [])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DashboardHeader />
      <AppNav />

      {/* Extra bottom padding on phones so the bottom bar never covers content. */}
      <main className="container py-8 pb-28 md:pb-8">
        {!mounted || isConnecting ? (
          <div className="h-64 animate-pulse rounded-lg border border-border bg-card" />
        ) : isConnected ? (
          children
        ) : (
          <div className="glass-panel mx-auto flex max-w-md flex-col items-center gap-4 p-10 text-center">
            <span className="pulse-ring flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Wallet className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Connect your wallet</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Connect a wallet to see your balances and start sending.
              </p>
            </div>
            <ConnectWalletButton />
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  )
}
