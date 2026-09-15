"use client"

import Link from "next/link"
import {
  ArrowUpRight,
  ArrowDownLeft,
  QrCode,
  ArrowLeftRight,
  Receipt,
  ChevronRight,
} from "lucide-react"
import { BalanceHero } from "@/components/app/BalanceHero"
import { AssetList } from "@/components/app/AssetList"
import { Reveal } from "@/components/marketing/Reveal"
import { useWallet } from "@/contexts/WalletContext"

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

export default function HomePage() {
  const { balances, isLoadingBalances } = useWallet()

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Reveal variant="scale">
        <BalanceHero />
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
        </section>
      </Reveal>

      <Reveal delay={120}>
        <section aria-labelledby="assets-heading">
          <h2 id="assets-heading" className="mb-4 text-base font-semibold tracking-tight">
            Your assets
          </h2>
          <AssetList balances={balances} isLoading={isLoadingBalances} />
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

          <div className="glass-panel flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Receipt className="h-5 w-5" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">No activity yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
              Payments, conversions and Naira transfers will appear here as you make them.
            </p>
          </div>
        </section>
      </Reveal>
    </div>
  )
}
