"use client"

import { useEffect, useState } from "react"
import { PageHeader } from "@/components/app/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/AmountInput"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ArrowDown } from "lucide-react"
import { DISPLAY_ASSETS } from "@/lib/assets"
import { decimalsForAsset, isPositiveAmount } from "@/lib/amountInput"
import {
  executeConversion,
  getConvertQuote,
  type ConvertQuote,
} from "@/lib/api-client"

export default function ConvertPage() {
  const [from, setFrom] = useState(DISPLAY_ASSETS[0]?.symbol ?? "ETH")
  const [to, setTo] = useState(DISPLAY_ASSETS[1]?.symbol ?? "USDC")
  const [amount, setAmount] = useState("")
  const [quote, setQuote] = useState<ConvertQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [converting, setConverting] = useState(false)
  const [convertError, setConvertError] = useState<string | null>(null)
  const [convertSuccess, setConvertSuccess] = useState<string | null>(null)

  const amountValid = amount === "" || isPositiveAmount(amount)
  const sameAsset = from === to
  const canQuote = amount !== "" && amountValid && !sameAsset

  const expiresAtMs = quote ? Date.parse(quote.expiresAt) : NaN
  const quoteExpired = quote !== null && !Number.isNaN(expiresAtMs) && expiresAtMs <= now
  const quoteLive = quote !== null && !quoteExpired

  useEffect(() => {
    if (!canQuote) {
      setQuote(null)
      setQuoteError(null)
      setQuoteLoading(false)
      return
    }

    let cancelled = false
    setQuoteLoading(true)
    setQuoteError(null)

    const timer = setTimeout(() => {
      getConvertQuote({ from, to, amount })
        .then((result) => {
          if (!cancelled) setQuote(result)
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setQuote(null)
            setQuoteError(err instanceof Error ? err.message : "Could not fetch a quote.")
          }
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false)
        })
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [from, to, amount, canQuote, refreshKey])

  useEffect(() => {
    if (!quote) return
    const expiresAt = Date.parse(quote.expiresAt)
    if (Number.isNaN(expiresAt)) return
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) {
      setNow(Date.now())
      return
    }
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50)
    return () => clearTimeout(timer)
  }, [quote])

  const flip = () => {
    setFrom(to)
    setTo(from)
  }

  const refreshQuote = () => {
    setConvertError(null)
    setConvertSuccess(null)
    setRefreshKey((key) => key + 1)
  }

  const handleConvert = async () => {
    if (!quote || !quoteLive || converting) return
    setConverting(true)
    setConvertError(null)
    setConvertSuccess(null)
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const result = await executeConversion({
        from,
        to,
        amount,
        idempotencyKey,
      })
      setConvertSuccess(
        result?.amountOut
          ? `Converted ${amount} ${from} to ${result.amountOut} ${to}.`
          : `Converted ${amount} ${from} to ${to}.`,
      )
      setQuote(null)
      setRefreshKey((key) => key + 1)
    } catch (err: unknown) {
      setConvertError(err instanceof Error ? err.message : "Could not complete the conversion.")
    } finally {
      setConverting(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Convert"
        description="Change one token into another, for example USDC into ETH."
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="convert-amount">You pay</Label>
            <div className="flex gap-2">
              <AmountInput
                id="convert-amount"
                placeholder="0.00"
                value={amount}
                onValueChange={setAmount}
                decimals={decimalsForAsset(from)}
                aria-invalid={!amountValid}
                className="h-auto border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight focus-visible:ring-0 flex-1"
              />
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id="convert-from" aria-label="Asset to pay with" className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPLAY_ASSETS.map((asset) => (
                    <SelectItem key={asset.symbol} value={asset.symbol}>
                      {asset.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!amountValid && (
              <p className="text-xs text-destructive">Enter an amount greater than zero.</p>
            )}
          </div>

          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={flip}
              aria-label="Swap the two assets"
            >
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="convert-receive">You receive</Label>
            <div className="flex gap-2">
              <Input
                id="convert-receive"
                value={quote?.amountOut ?? ""}
                readOnly
                aria-readonly="true"
                placeholder="0.00"
                className="h-auto border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight text-muted-foreground focus-visible:ring-0 flex-1"
              />
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="convert-to" aria-label="Asset to receive" className="w-32 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DISPLAY_ASSETS.map((asset) => (
                    <SelectItem key={asset.symbol} value={asset.symbol}>
                      {asset.symbol}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sameAsset && (
              <p className="text-xs text-destructive">Pick two different assets.</p>
            )}
          </div>

          <dl className="space-y-2 rounded-md border border-border p-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Rate</dt>
              <dd className="text-muted-foreground">{quote?.rate ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Fee</dt>
              <dd className="text-muted-foreground">{quote?.fee ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2 font-medium">
              <dt>You receive</dt>
              <dd>{quote?.amountOut ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="text-muted-foreground">{quote?.expiresAt ?? "—"}</dd>
            </div>
          </dl>

          {quoteLoading && (
            <p className="text-xs text-muted-foreground">Fetching quote…</p>
          )}
          {quoteError && (
            <p className="text-xs text-destructive">{quoteError}</p>
          )}
          {quoteExpired && (
            <p className="text-xs text-destructive">This quote has expired. Refresh it to continue.</p>
          )}
          {convertError && (
            <p className="text-xs text-destructive">{convertError}</p>
          )}
          {convertSuccess && (
            <p className="text-xs text-emerald-600">{convertSuccess}</p>
          )}

          {quoteExpired ? (
            <Button
              type="button"
              variant="outline"
              className="h-12 w-full rounded-full text-base font-semibold"
              onClick={refreshQuote}
              disabled={quoteLoading}
            >
              {quoteLoading ? "Refreshing…" : "Refresh quote"}
            </Button>
          ) : (
            <Button
              type="button"
              className="h-12 w-full rounded-full text-base font-semibold"
              onClick={handleConvert}
              disabled={!quoteLive || converting}
            >
              {converting ? "Converting…" : "Convert"}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
