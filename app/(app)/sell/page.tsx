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
import { Landmark, Plus } from "lucide-react"
import { DISPLAY_ASSETS } from "@/lib/assets"

export default function SellPage() {
  const [amount, setAmount] = useState("")
  const [asset, setAsset] = useState(DISPLAY_ASSETS[1]?.symbol ?? "USDC")

  const amountValid = amount === "" || Number(amount) > 0

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Sell for Naira"
        description="Convert crypto to Naira, paid into your Nigerian bank account."
      />

      <Card>
        <CardContent className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="sell-amount">You sell</Label>
            <div className="flex gap-2">
              <Input
                id="sell-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={!amountValid}
                className="h-auto border-0 bg-transparent px-0 py-1 text-3xl font-semibold tabular-nums tracking-tight focus-visible:ring-0 flex-1"
              />
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger id="sell-asset" className="w-32 shrink-0">
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
            {!amountValid && (
              <p className="text-xs text-destructive">Enter an amount greater than zero.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Paid into</Label>
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-3 rounded-md border border-dashed border-border p-4 text-left text-sm text-muted-foreground disabled:cursor-not-allowed"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                <Landmark className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">No bank account yet</span>
                <span className="block text-xs">Add the account that receives your Naira</span>
              </span>
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
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
            Selling needs the Naira payout partner, a verified bank account and the identity
            check. None of those are connected yet.
          </PendingServiceNote>
        </CardContent>
      </Card>
    </div>
  )
}
