"use client"

import { Card, CardContent } from "@/components/ui/card"
import type { Balance } from "@/types/dashboard"

interface AssetListProps {
  balances: Balance[]
  isLoading: boolean
}

/**
 * Balances exactly as the chain reports them. No fiat column: prices need a
 * price feed we have not wired yet, and a made-up number is worse than none.
 */
export function AssetList({ balances, isLoading }: AssetListProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    )
  }

  if (balances.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No balance on this wallet yet. Buy with Naira, or receive from another wallet.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <ul className="space-y-2">
      {balances.map((asset) => (
        <li key={asset.symbol}>
          <Card className="transition-colors hover:border-primary/40">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl"
                  aria-hidden="true"
                >
                  {asset.icon}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium leading-tight">{asset.symbol}</span>
                  <span className="block truncate text-xs text-muted-foreground">{asset.name}</span>
                </span>
              </div>
              <span className="shrink-0 text-right font-medium tabular-nums">{asset.balance}</span>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
