"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import QRCode from "qrcode"
import { Card, CardContent } from "@/components/ui/card"
import { getPaymentRequest, type PaymentRequestDetail } from "@/lib/api-client"
import {
  buildRequestUri,
  formatRequestAmount,
  resolveRequestView,
} from "@/lib/payment-request-view"

const BADGES: Record<string, string> = {
  open: "Open",
  partially_paid: "Partially paid",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
}

export default function PayRequestPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const [request, setRequest] = useState<PaymentRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState("")

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getPaymentRequest(id)
      .then((r) => !cancelled && setRequest(r))
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this request.")
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const view = request ? resolveRequestView(request.status, request.expires_at) : null
  const isOpen = view === "open" || view === "partially_paid"

  useEffect(() => {
    if (!request || !isOpen) {
      setQr("")
      return
    }
    let cancelled = false
    const uri = buildRequestUri(request.id, request.asset, request.amount_remaining)
    QRCode.toDataURL(uri, { margin: 1, width: 240 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(""))
    return () => {
      cancelled = true
    }
  }, [request, isOpen])

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
      <Card className="w-full">
        <CardContent className="space-y-5 p-6 text-center">
          <h1 className="text-lg font-semibold">Payment request</h1>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!request && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
          {request && view && (
            <>
              <p className="text-3xl font-bold">
                {formatRequestAmount(request.requested_amount, request.asset)} {request.asset}
              </p>
              <p
                data-testid="request-status"
                className="inline-block rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold"
              >
                {BADGES[view]}
              </p>
              {request.recipient_tag && (
                <p className="text-sm text-muted-foreground">To {request.recipient_tag}</p>
              )}
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Paid so far</dt>
                  <dd>
                    {formatRequestAmount(request.amount_paid, request.asset)} {request.asset}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Remaining</dt>
                  <dd>
                    {formatRequestAmount(request.amount_remaining, request.asset)} {request.asset}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">
                    {view === "expired" ? "Expired" : "Expires"}
                  </dt>
                  <dd>{new Date(request.expires_at).toLocaleString()}</dd>
                </div>
              </dl>
              {isOpen && qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="QR code for this payment request" className="mx-auto h-60 w-60" />
              )}
              {view === "paid" && (
                <p className="text-sm text-green-600">This request has been paid in full.</p>
              )}
              {view === "expired" && (
                <p className="text-sm text-muted-foreground">
                  This request has expired and can no longer be paid.
                </p>
              )}
              {view === "cancelled" && (
                <p className="text-sm text-muted-foreground">This request was cancelled.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
