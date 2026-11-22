"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { cancelPaymentRequest, listPaymentRequests, type PaymentRequestSummary } from "@/lib/api-client"
import { formatRequestAmount, resolveRequestView } from "@/lib/payment-request-view"

const LABELS: Record<string, string> = {
  open: "Open",
  partially_paid: "Partially paid",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
}

export function MyPaymentRequests() {
  const [items, setItems] = useState<PaymentRequestSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setItems(await listPaymentRequests())
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load your payment requests.")
    }
  }, [])

  async function handleCancel(id: string) {
    if (!window.confirm("Cancel this payment request? It can no longer be paid.")) return
    try {
      await cancelPaymentRequest(id)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not cancel the request.")
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="mt-6" aria-labelledby="my-payment-requests">
      <h2 id="my-payment-requests" className="mb-2 text-sm font-semibold">
        Your payment requests
      </h2>
      <Card>
        <CardContent className="divide-y divide-border p-0">
          {error && (
            <p role="alert" className="p-4 text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && items === null && (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          )}
          {items?.length === 0 && (
            <p className="p-4 text-sm text-muted-foreground">No payment requests yet.</p>
          )}
          {items?.map((r) => {
            const view = resolveRequestView(r.status, r.expires_at)
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <Link href={`/pay/${r.id}`} className="font-medium hover:underline">
                    {formatRequestAmount(r.requested_amount, r.asset)} {r.asset}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    Paid {formatRequestAmount(r.amount_paid, r.asset)} {r.asset}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold">
                    {LABELS[view]}
                  </span>
                  {view === "open" && r.status === "pending" && (
                    <Button variant="outline" size="sm" onClick={() => void handleCancel(r.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </section>
  )
}
