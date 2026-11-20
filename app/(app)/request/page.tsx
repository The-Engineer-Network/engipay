"use client"

import { useState } from "react"
import Link from "next/link"
import { PageHeader } from "@/components/app/PageHeader"
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
import { createMoneyRequest } from "@/lib/api-client"
import { HandCoins, CheckCircle2, ArrowRight } from "lucide-react"

const ASSETS = ["USDC", "XLM"] as const
type Asset = (typeof ASSETS)[number]

export default function RequestMoneyPage() {
  const [recipientTag, setRecipientTag] = useState("")
  const [asset, setAsset] = useState<Asset>("USDC")
  const [amount, setAmount] = useState("")
  const [note, setNote] = useState("")
  const [expiryHours, setExpiryHours] = useState(48)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedTag = recipientTag.trim()
    const trimmedAmount = amount.trim()

    if (!trimmedTag) {
      setError("Recipient tag is required.")
      return
    }
    if (!trimmedAmount || isNaN(Number(trimmedAmount)) || Number(trimmedAmount) <= 0) {
      setError("Enter a valid positive amount.")
      return
    }
    if (note.length > 280) {
      setError("Note must be 280 characters or fewer.")
      return
    }

    setSubmitting(true)
    try {
      const res = await createMoneyRequest({
        recipient_tag: trimmedTag,
        asset,
        amount: trimmedAmount,
        note: note.trim() || undefined,
        expiry_hours: expiryHours,
      })
      setCreatedId(res.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong."
      setError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (createdId) {
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader title="Request sent" description="The recipient will be notified." />
        <Card>
          <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500" aria-hidden="true" />
            <div>
              <p className="text-base font-semibold">Money request created</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {recipientTag} will see it in their inbox and can accept or decline.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <Link href="/request/inbox">
                <Button className="w-full">View inbox</Button>
              </Link>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  setCreatedId(null)
                  setRecipientTag("")
                  setAmount("")
                  setNote("")
                }}
              >
                Request again
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg">
      <PageHeader
        title="Request money"
        description="Ask another EngiPay user to pay you. They can accept or decline."
      />

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="recipient-tag">Their EngiPay tag</Label>
              <Input
                id="recipient-tag"
                placeholder="e.g. alice"
                value={recipientTag}
                onChange={(e) => setRecipientTag(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={submitting}
                required
              />
            </div>

            <div className="flex gap-3">
              <div className="w-28 shrink-0 space-y-1.5">
                <Label htmlFor="asset-select">Asset</Label>
                <Select
                  value={asset}
                  onValueChange={(v) => setAsset(v as Asset)}
                  disabled={submitting}
                >
                  <SelectTrigger id="asset-select" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSETS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex-1 space-y-1.5">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0.000001"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="note">
                Note{" "}
                <span className="text-xs text-muted-foreground">(optional, max 280 chars)</span>
              </Label>
              <Input
                id="note"
                placeholder="What&apos;s it for?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={280}
                disabled={submitting}
              />
              {note.length > 0 && (
                <p className="text-right text-xs text-muted-foreground">{note.length}/280</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="expiry">Expires in</Label>
              <Select
                value={String(expiryHours)}
                onValueChange={(v) => setExpiryHours(Number(v))}
                disabled={submitting}
              >
                <SelectTrigger id="expiry" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="48">48 hours</SelectItem>
                  <SelectItem value="72">3 days</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                "Sending request…"
              ) : (
                <>
                  <HandCoins className="mr-2 h-4 w-4" aria-hidden="true" />
                  Send request
                  <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mt-4 rounded-xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">Requests sent to you?</p>
            <p className="text-xs text-muted-foreground">
              View pending requests in your inbox and pay or decline them.
            </p>
          </div>
          <Link
            href="/request/inbox"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            Inbox
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  )
}
