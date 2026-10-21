"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/app/PageHeader"
import { PendingServiceNote } from "@/components/app/PendingServiceNote"
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
import { DISPLAY_ASSETS } from "@/lib/assets"
import { isPositiveAmount } from "@/lib/amountInput"
import { ApiRequestError, apiRequest } from "@/lib/api"
import { type BuyQuote, formatNaira, formatRate, isQuoteLive, secondsLeft } from "@/lib/buy"
import { NairaAnchorRamp } from "@/components/naira/NairaAnchorRamp"
import { Landmark, Zap } from "lucide-react"
import { cn } from "@/lib/utils"

/** Quick amounts, in Naira. */
const PRESETS = ["5000", "10000", "50000", "100000"]

/** Wait this long after the last keystroke before asking for a quote. */
const DEBOUNCE_MS = 400

interface OrderResponse {
  id: string
  quote_id: string
  status: string
  message: string
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.status === 401 ? "Sign in with your wallet in Settings to buy." : error.message
  }
  return "Something went wrong. Try again."
}

export default function BuyPage() {
  const [method, setMethod] = useState<"anchor" | "order">("anchor")
  const [naira, setNaira] = useState("")
  const [asset, setAsset] = useState(DISPLAY_ASSETS[1]?.symbol ?? "USDC")
  // Ticks once a second so the expiry countdown and lapse check stay current.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const debouncedNaira = useDebounced(naira, DEBOUNCE_MS)
  const amountValid = naira === "" || isPositiveAmount(naira)
  const wantsQuote = debouncedNaira !== "" && isPositiveAmount(debouncedNaira)

  // A quote is a snapshot of the price at one moment. It is only refetched when
  // the amount or asset changes, or when it lapses (below).
  const quote = useQuery({
    queryKey: ["buy-quote", debouncedNaira, asset],
    queryFn: async () =>
      (await apiRequest<BuyQuote>("/v1/buy/quotes", {
        method: "POST",
        body: JSON.stringify({ naira_amount: debouncedNaira, asset }),
      })) as BuyQuote,
    enabled: wantsQuote,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const quoteData = quote.data
  // The quote, only while it is still live. Undefined once it lapses.
  const liveQuote =
    quoteData !== undefined && isQuoteLive(quoteData.expires_at, now) ? quoteData : undefined
  const lapsed = quoteData !== undefined && liveQuote === undefined
  const { refetch } = quote

  // A lapsed quote is replaced with a fresh one, so the user never sees a stale rate.
  useEffect(() => {
    if (lapsed) void refetch()
  }, [lapsed, refetch])

  const createOrder = useMutation({
    mutationFn: async (quoteId: string) =>
      (await apiRequest<OrderResponse>("/v1/buy/orders", {
        method: "POST",
        body: JSON.stringify({ quote_id: quoteId }),
      })) as OrderResponse,
  })

  const canContinue = liveQuote !== undefined && !createOrder.isPending

  const handleContinue = () => {
    if (!liveQuote) return
    createOrder.mutate(liveQuote.id)
  }

  const quoteError = quote.error ? describeError(quote.error) : null
  const orderError = createOrder.error ? describeError(createOrder.error) : null

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <PageHeader
        title="Buy with Naira"
        description="Pay from your Nigerian bank account or card, and receive crypto."
      />

      {/* Method Switcher */}
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-full border border-border bg-card/60 p-1 shadow-sm backdrop-blur">
          <button
            type="button"
            onClick={() => setMethod("anchor")}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              method === "anchor"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Landmark className="h-3.5 w-3.5" />
            Stellar Anchor (SEP-24)
          </button>
          <button
            type="button"
            onClick={() => setMethod("order")}
            className={cn(
              "flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium transition-colors",
              method === "order"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Zap className="h-3.5 w-3.5" />
            Direct Quote
          </button>
        </div>
      </div>

      {method === "anchor" ? (
        <NairaAnchorRamp defaultTab="deposit" />
      ) : (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="space-y-2">
              <Label htmlFor="buy-naira">You pay</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 text-3xl font-semibold text-muted-foreground">
                  ₦
                </span>
                <AmountInput
                  id="buy-naira"
                  placeholder="0"
                  value={naira}
                  onValueChange={(value) => {
                    setNaira(value)
                    createOrder.reset()
                  }}
                  decimals={2}
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
                    onClick={() => {
                      setNaira(preset)
                      createOrder.reset()
                    }}
                  >
                    {preset}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="buy-asset">You receive</Label>
              <Select
                value={asset}
                onValueChange={(value) => {
                  setAsset(value)
                  createOrder.reset()
                }}
              >
                <SelectTrigger id="buy-asset" aria-label="Asset to receive">
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

            <dl className="space-y-2 rounded-md border border-border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Rate</dt>
                <dd className="text-muted-foreground">
                  {liveQuote ? formatRate(liveQuote.rate_kobo, liveQuote.asset) : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Fee</dt>
                <dd className="text-muted-foreground">{liveQuote ? formatNaira(liveQuote.fee_kobo) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-border pt-2 font-medium">
                <dt>You receive</dt>
                <dd>{liveQuote ? `${liveQuote.receive} ${liveQuote.asset}` : "—"}</dd>
              </div>
            </dl>

            {quote.isFetching && !quoteData && wantsQuote && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Getting your rate…
              </p>
            )}
            {liveQuote && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Rate held for {secondsLeft(liveQuote.expires_at, now)} more seconds.
              </p>
            )}
            {lapsed && (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                This rate has expired. Getting a new one…
              </p>
            )}
            {quoteError && (
              <p role="alert" className="text-xs text-destructive">
                {quoteError}
              </p>
            )}

            <Button
              type="button"
              className="h-12 w-full rounded-full text-base font-semibold"
              disabled={!canContinue}
              onClick={handleContinue}
            >
              {createOrder.isPending ? "Creating order…" : "Continue"}
            </Button>

            {createOrder.data && (
              <div role="status" className="rounded-md border border-border p-4 text-sm">
                <p className="font-medium">Order created</p>
                <p className="mt-1 text-muted-foreground">{createOrder.data.message}</p>
              </div>
            )}
            {orderError && (
              <p role="alert" className="text-xs text-destructive">
                {orderError}
              </p>
            )}

            <PendingServiceNote>
              Orders wait for a licensed Naira partner. Until one is connected, no payment is taken
              and no payment instructions are issued.
            </PendingServiceNote>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
