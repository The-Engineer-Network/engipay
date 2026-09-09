"use client"

import { ArrowUpRight, ArrowDownLeft, CreditCard } from "lucide-react"

interface QuickActionsProps {
  onAction?: (action: string) => void
}

const ACTIONS = [
  { icon: ArrowUpRight, label: "Send", description: "Transfer crypto" },
  { icon: ArrowDownLeft, label: "Receive", description: "Share your address" },
  { icon: CreditCard, label: "Pay Merchant", description: "Buy services" },
] as const

export function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <section className="mb-8" aria-labelledby="quick-actions-heading">
      <h2 id="quick-actions-heading" className="mb-4 text-lg font-semibold tracking-tight">
        Quick actions
      </h2>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ACTIONS.map(({ icon: Icon, label, description }) => (
          <button
            key={label}
            type="button"
            onClick={() => onAction?.(label)}
            className="group flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-muted-foreground">{description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
