"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Eye, EyeOff, Plus, Landmark, Copy, Check } from "lucide-react"
import { useWallet } from "@/contexts/WalletContext"
import { shortenAddress } from "@/lib/payment-uri"
import { cn } from "@/lib/utils"

const HIDDEN_KEY = "engipay-hide-balance"

/**
 * The first thing on the home screen: what you hold, and the two things people
 * most often want to do with it.
 *
 * There is deliberately no fiat total. Converting balances to Naira needs a
 * price feed we have not wired yet, and an invented number on a payments app
 * is worse than no number.
 */
export function BalanceHero() {
  const { balances, isLoadingBalances, walletAddress } = useWallet()
  const [hidden, setHidden] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      setHidden(localStorage.getItem(HIDDEN_KEY) === "true")
    } catch {
      // Private mode. Default to showing the balance.
    }
  }, [])

  const toggleHidden = () => {
    setHidden((previous) => {
      const next = !previous
      try {
        localStorage.setItem(HIDDEN_KEY, String(next))
      } catch {
        // Not persisting is fine.
      }
      return next
    })
  }

  const copyAddress = async () => {
    if (!walletAddress) return
    try {
      await navigator.clipboard.writeText(walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard blocked; the address is still visible on screen.
    }
  }

  const [primary, ...rest] = balances

  return (
    <section
      className="glass-panel relative overflow-hidden p-6 sm:p-8"
      aria-labelledby="balance-heading"
    >
      <div
        className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/20 blur-[80px]"
        aria-hidden="true"
      />

      <div className="relative">
        <div className="mb-1 flex items-center justify-between gap-4">
          <h2 id="balance-heading" className="text-sm text-muted-foreground">
            Available balance
          </h2>
          <button
            type="button"
            onClick={toggleHidden}
            aria-pressed={hidden}
            aria-label={hidden ? "Show balance" : "Hide balance"}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {isLoadingBalances ? (
          <div className="h-11 w-48 animate-pulse rounded-md bg-muted" />
        ) : primary ? (
          <p className="flex items-baseline gap-2">
            <span className="text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl">
              {hidden ? "••••" : primary.balance}
            </span>
            <span className="text-lg font-medium text-muted-foreground">{primary.symbol}</span>
          </p>
        ) : (
          <p className="text-2xl font-semibold text-muted-foreground">Nothing here yet</p>
        )}

        {rest.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {rest.map((asset) => (
              <li
                key={asset.symbol}
                className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1.5 text-sm"
              >
                <span aria-hidden="true">{asset.icon}</span>
                <span className="tabular-nums">{hidden ? "••••" : asset.balance}</span>
                <span className="text-muted-foreground">{asset.symbol}</span>
              </li>
            ))}
          </ul>
        )}

        {walletAddress && (
          <button
            type="button"
            onClick={copyAddress}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {shortenAddress(walletAddress, 6, 4)}
            {copied ? (
              <Check className="h-3 w-3 text-success" aria-hidden="true" />
            ) : (
              <Copy className="h-3 w-3" aria-hidden="true" />
            )}
            <span className="sr-only">Copy your wallet address</span>
          </button>
        )}

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/buy"
            className={cn(
              "glow-button flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-6 py-3",
              "font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            )}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add money
          </Link>
          <Link
            href="/sell"
            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-border px-6 py-3 font-semibold transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <Landmark className="h-4 w-4" aria-hidden="true" />
            Cash out
          </Link>
        </div>
      </div>
    </section>
  )
}
