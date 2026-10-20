"use client"

import { useState, useEffect, useCallback } from "react"
import { PageHeader } from "@/components/app/PageHeader"
import { PendingServiceNote } from "@/components/app/PendingServiceNote"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DISPLAY_ASSETS } from "@/lib/assets"
import { createQuote, ApiError } from "@/lib/api"
import type { QuoteResponse, Product, Asset } from "@/lib/api"

/** Quick amounts, in Naira. */
const PRESETS = ["5000", "10000", "50000", "100000"]

// 1 USDC ≈ ₦1600 (placeholder exchange rate until the ramp partner is live).
const NAIRA_PER_USDC = 1600
// USDC has 7 ledger decimals.
const USDC_MINOR_PER_UNIT = 10_000_000

export default function BuyPage() {
  const [naira, setNaira] = useState("")
  const [asset, setAsset] = useState(DISPLAY_ASSETS[1]?.symbol ?? "USDC")
  const [quote, setQuote] = useState<QuoteResponse | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)

  const amountValid = naira === "" || Number(naira) > 0

  /** Gross USDC in ledger smallest units for the entered Naira amount. */
  const grossMinor =
    naira && Number(naira) > 0
      ? Math.round((Number(naira) / NAIRA_PER_USDC) * USDC_MINOR_PER_UNIT)
      : 0

  const fetchQuote = useCallback(async () => {
    if (grossMinor <= 0 || asset !== "USDC") {
      setQuote(null)
      return
    }
    setLoadingQuote(true)
    setQuoteError(null)
    try {
      const q = await createQuote({
        product: "buy" as Product,
        asset: "Usdc" as Asset,
        gross_minor: grossMinor,
      })
      setQuote(q)
    } catch (err) {
      setQuote(null)
      setQuoteError(err instanceof ApiError ? err.message : "Could not fetch fee")
    } finally {
      setLoadingQuote(false)
    }
  }, [grossMinor, asset])

  useEffect(() => {
    const timer = setTimeout(fetchQuote, 400)
    return () => clearTimeout(timer)
  }, [fetchQuote])

  const feeDisplay = (() => {
    if (!quote) return "—"
    const feeUsdc = quote.fee_minor / USDC_MINOR_PER_UNIT
    return `${feeUsdc.toFixed(2)} USDC`
  })()

  const receiveDisplay = (() => {
    if (!quote) return "—"
    const net = (quote.gross_minor - quote.fee_minor) / USDC_MINOR_PER_UNIT
    return `${Math.max(0, net).toFixed(2)} USDC`
  })()

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Buy with Naira"
        description="Pay from your Nigerian bank account or card, and receive crypto."
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="buy-naira">You pay</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-semibold text-muted-foreground">
                ₦
              </span>
              <Input
                id="buy-naira"
                inputMode="numeric"
                placeholder="0"
                value={naira}
                onChange={(event) => setNaira(event.target.value)}
                aria-invalid={!amountValid}
                className="h-auto border-0 bg-transparent py-1 pl-8 text-3xl font-semibold tabular-nums tracking-tight focus-visible:ring-0"
              />
            </div>
            {!amountValid && (
              <p className="text-xs text-destructive">Enter an amount greater than zero.</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setNaira(preset)}
                >
                  ₦{Number(preset).toLocaleString("en-NG")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="buy-asset">You receive</Label>
            <div className="flex gap-2">
              <Input
                value=""
                readOnly
                placeholder="0.00"
                className="h-auto flex-1 border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight text-muted-foreground focus-visible:ring-0"
              />
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger id="buy-asset" className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPLAY_ASSETS.map((item) => (
                    <SelectItem key={item.symbol} value={item.symbol}>
                      {item.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <dl className="space-y-2 rounded-md border border-border p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Rate</dt>
              <dd className="text-muted-foreground">₦{NAIRA_PER_USDC.toLocaleString()} / USDC</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Fee</dt>
              <dd className={loadingQuote ? "animate-pulse text-muted-foreground" : "text-muted-foreground"}>
                {loadingQuote ? "…" : feeDisplay}
              </dd>
            </div>
            {quoteError && (
              <p className="text-xs text-destructive">{quoteError}</p>
            )}
            <div className="flex justify-between gap-4 border-t border-border pt-2 font-medium">
              <dt>You receive</dt>
              <dd>{loadingQuote ? "…" : receiveDisplay}</dd>
            </div>
          </dl>

          <Button type="button" className="h-12 w-full rounded-full text-base font-semibold" disabled>
            Continue
          </Button>

          <PendingServiceNote>
            Buying needs a licensed Naira partner and a one-time identity check. Neither is
            connected yet, so this screen cannot take a payment.
          </PendingServiceNote>
        </CardContent>
      </Card>
    </div>
  )
}
