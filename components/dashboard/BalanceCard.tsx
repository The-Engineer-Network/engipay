"use client"

import { Card, CardContent } from "@/components/ui/card"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface BalanceCardProps {
  symbol: string
  name: string
  balance: string
  value: string
  change: string
  icon: string
  trend: "up" | "down" | "stable"
  volume: string
}

const TREND_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
} as const

function toneFor(change: string) {
  if (change.startsWith("+")) return "text-success"
  if (change.startsWith("-")) return "text-destructive"
  return "text-muted-foreground"
}

export function BalanceCard({
  symbol,
  name,
  balance,
  value,
  change,
  icon,
  trend,
}: BalanceCardProps) {
  const TrendIcon = TREND_ICON[trend] ?? Minus
  const tone = toneFor(change)

  return (
    <Card className="transition-colors hover:border-primary/40">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xl"
              aria-hidden="true"
            >
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold leading-tight">{symbol}</h3>
              <p className="truncate text-xs text-muted-foreground">{name}</p>
            </div>
          </div>
          <TrendIcon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden="true" />
        </div>

        <div className="space-y-1">
          {/* tabular-nums keeps figures aligned across the grid */}
          <div className="text-2xl font-semibold tabular-nums">{balance}</div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">{value}</span>
            <span className={cn("text-sm font-medium tabular-nums", tone)}>{change}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
