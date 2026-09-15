"use client"

import { useState } from "react"
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
import { ArrowDown } from "lucide-react"
import { DISPLAY_ASSETS } from "@/lib/assets"

export default function ConvertPage() {
  const [from, setFrom] = useState(DISPLAY_ASSETS[0]?.symbol ?? "ETH")
  const [to, setTo] = useState(DISPLAY_ASSETS[1]?.symbol ?? "USDC")
  const [amount, setAmount] = useState("")

  const amountValid = amount === "" || Number(amount) > 0
  const sameAsset = from === to

  const flip = () => {
    setFrom(to)
    setTo(from)
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
            <Label htmlFor="convert-from">You pay</Label>
            <div className="flex gap-2">
              <Input
                id="convert-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={!amountValid}
                className="h-auto border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight focus-visible:ring-0 flex-1"
              />
              <Select value={from} onValueChange={setFrom}>
                <SelectTrigger id="convert-from" className="w-32 shrink-0">
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
            <Label htmlFor="convert-to">You receive</Label>
            <div className="flex gap-2">
              <Input
                id="convert-receive"
                value=""
                readOnly
                placeholder="0.00"
                className="h-auto border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight text-muted-foreground focus-visible:ring-0 flex-1"
              />
              <Select value={to} onValueChange={setTo}>
                <SelectTrigger id="convert-to" className="w-32 shrink-0">
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
            Convert
          </Button>

          <PendingServiceNote>
            Conversion needs the pricing and swap service, which is not built yet. The screen is
            ready, so it starts working as soon as the backend is connected.
          </PendingServiceNote>
        </CardContent>
      </Card>
    </div>
  )
}
