"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  ArrowDownLeft,
  QrCode,
  ArrowLeftRight,
  Receipt,
  ChevronRight,
  ShieldCheck,
  Wallet,
  Store,
  ArrowRight,
} from "lucide-react"
import { BalanceHero } from "@/components/app/BalanceHero"
import { AssetList } from "@/components/app/AssetList"
import { Reveal } from "@/components/marketing/Reveal"
import { useWallet } from "@/contexts/WalletContext"
import { useEngiPayBalances } from "@/hooks/use-engipay-balances"
import { useEngiPayTransactions } from "@/hooks/use-engipay-transactions"
import type { Balance } from "@/types/dashboard"
import { cn } from "@/lib/utils"

const ASSET_METADATA: Record<string, { name: string; icon: string }> = {
  USDC: { name: "USD Coin", icon: "💵" },
  ETH: { name: "Ether", icon: "🔷" },
  XLM: { name: "Stellar Lumens", icon: "✨" },
  BTC: { name: "Bitcoin", icon: "₿" },
}

/**
 * The four things people do between funding and cashing out. Adding money and
 * cashing out live on the balance card above, so they are not repeated here.
 */
const ACTIONS = [
  {
    href: "/send",
    label: "Send",
    description: "To any wallet",
    icon: ArrowUpRight,
  },
  {
    href: "/receive",
    label: "Receive",
    description: "Show your code",
    icon: ArrowDownLeft,
  },
  {
    href: "/scan",
    label: "Scan",
    description: "Pay a code",
    icon: QrCode,
  },
  {
    href: "/convert",
    label: "Convert",
    description: "Swap tokens",
    icon: ArrowLeftRight,
  },
] as const

type BalanceSource = "custodial" | "wallet"

export default function HomePage() {
  const { balances: walletBalances, isLoadingBalances: isLoadingWallet } = useWallet()
  const { balances: engipayBalances, isLoading: isLoadingEngiPay } = useEngiPayBalances()
  const { transactions, isLoading: isLoadingTx } = useEngiPayTransactions({ maxItems: 5 })

  // Check if user has an active session token for custodial balance
  const hasToken =
    typeof window !== "undefined" ? Boolean(localStorage.getItem("engipay-token")) : false

  const [source, setSource] = useState<BalanceSource>(hasToken ? "custodial" : "wallet")

  const custodialDashboardBalances = useMemo<Balance[]>(() => {
    return engipayBalances.map((b) => {
      const meta = ASSET_METADATA[b.asset] ?? { name: b.asset, icon: "🪙" }
      return {
        symbol: b.asset,
        name: meta.name,
        balance: b.available,
        value: "$0.00",
        change: "+0.0%",
        icon: meta.icon,
        trend: "stable",
        volume: "EngiPay Custody",
        held: b.held,
      } as Balance & { held?: string }
    })
  }, [engipayBalances])

  const activeBalances = source === "custodial" && hasToken ? custodialDashboardBalances : walletBalances
  const activeIsLoading = source === "custodial" && hasToken ? isLoadingEngiPay : isLoadingWallet

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Source Switcher if authenticated */}
      {hasToken && (
        <div className="flex items-center justify-center">
          <div className="inline-flex rounded-full border border-border bg-card/60 p-1 shadow-sm backdrop-blur">
            <button
              type="button"
              onClick={() => setSource("custodial")}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                source === "custodial"
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              EngiPay Account
            </button>
            <button
              type="button"
              onClick={() => setSource("wallet")}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
                source === "wallet"
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Wallet className="h-3.5 w-3.5" />
              External Wallet
            </button>
          </div>
        </div>
      )}

      <Reveal variant="scale">
        <BalanceHero balances={activeBalances} isLoading={activeIsLoading} />
      </Reveal>

      <Reveal delay={60}>
        <section aria-labelledby="actions-heading">
          <h2 id="actions-heading" className="sr-only">
            Quick actions
          </h2>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ACTIONS.map(({ href, label, description, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className="lift-card shine glass-panel group flex flex-col items-start gap-3 p-4 text-left"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted-foreground">{description}</span>
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-3">
            <Link
              href="/pos"
              className="lift-card shine glass-panel group flex items-center justify-between gap-4 p-4 border border-primary/25 bg-primary/5 hover:border-primary/50 transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow">
                  <Store className="h-5 w-5" />
                </span>
                <div>
                  <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                    Shop POS Counter
                    <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      NEW
                    </span>
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Real-time QR checkout with instant testnet settlement
                  </span>
                </div>
              </div>
              <span className="flex items-center gap-1 text-xs font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
                Launch Terminal
                <ArrowRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </section>
      </Reveal>

      <Reveal delay={120}>
        <section aria-labelledby="assets-heading">
          <div className="mb-4 flex items-center justify-between">
            <h2 id="assets-heading" className="text-base font-semibold tracking-tight">
              {source === "custodial" && hasToken ? "EngiPay Account Assets" : "Your wallet assets"}
            </h2>
            {source === "custodial" && (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                Custodial (Instant Transfers)
              </span>
            )}
          </div>
          <AssetList balances={activeBalances} isLoading={activeIsLoading} />
        </section>
      </Reveal>

      <Reveal delay={180}>
        <section aria-labelledby="activity-heading">
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 id="activity-heading" className="text-base font-semibold tracking-tight">
              Recent activity
            </h2>
            <Link
              href="/activity"
              className="flex items-center gap-1 text-sm text-primary transition-opacity hover:opacity-80"
            >
              See all
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>

          {isLoadingTx ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : transactions.length > 0 ? (
            <ul className="space-y-2">
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="lift-card glass-panel flex items-center justify-between p-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-full text-sm",
                        tx.direction === "credit"
                          ? "bg-success/15 text-success"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      {tx.direction === "credit" ? (
                        <ArrowDownLeft className="h-4 w-4" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4" />
                      )}
                    </span>
                    <div>
                      <span className="block text-sm font-medium capitalize">
                        {tx.description ?? tx.type}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {new Date(tx.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={cn(
                        "block font-semibold tabular-nums",
                        tx.direction === "credit" ? "text-success" : ""
                      )}
                    >
                      {tx.direction === "credit" ? "+" : "-"}
                      {tx.amount} {tx.asset}
                    </span>
                    <span className="block text-[11px] capitalize text-muted-foreground">
                      {tx.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="glass-panel flex flex-col items-center gap-3 p-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Receipt className="h-5 w-5" aria-hidden="true" />
              </span>
              <p className="text-sm font-medium">No activity yet</p>
              <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                Payments, conversions and Naira transfers will appear here as you make them.
              </p>
            </div>
          )}
        </section>
      </Reveal>
    </div>
  )
}
