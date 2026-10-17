"use client"

import { useState } from "react"
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

/** Quick amounts, in Naira. */
const PRESETS = ["5000", "10000", "50000", "100000"]

export default function BuyPage() {
  const [naira, setNaira] = useState("")
  const [asset, setAsset] = useState(DISPLAY_ASSETS[1]?.symbol ?? "USDC")

  const amountValid = naira === "" || isPositiveAmount(naira)

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
              <AmountInput
                id="buy-naira"
                placeholder="0"
                value={naira}
                onValueChange={setNaira}
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
                  onClick={() => setNaira(preset)}
                >
                  ₦{Number(preset).toLocaleString("en-NG")}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="buy-receive">You receive</Label>
            <div className="flex gap-2">
              <Input
                id="buy-receive"
                value=""
                readOnly
                aria-readonly="true"
                placeholder="0.00"
                className="h-auto flex-1 border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight text-muted-foreground focus-visible:ring-0"
              />
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger id="buy-asset" aria-label="Asset to receive" className="w-32 shrink-0">
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
              <dd className="text-muted-foreground">—</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Fee</dt>
              <dd className="text-muted-foreground">—</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2 font-medium">
              <dt>You receive</dt>
              <dd>—</dd>
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
