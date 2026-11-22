"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import QRCode from "qrcode"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getPaymentRequest, payPaymentRequest, type PaymentRequestDetail } from "@/lib/api-client"
import {
  buildRequestUri,
  formatRequestAmount,
  resolveRequestView,
} from "@/lib/payment-request-view"
import { useWallet } from "@/contexts/WalletContext"
import { readSessionToken } from "@/lib/api-client"
import { Loader2 } from "lucide-react"
import { toast } from "@/hooks/use-toast"

const BADGES: Record<string, string> = {
  open: "Open",
  partially_paid: "Partially paid",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
}

export default function PayRequestPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id
  const [request, setRequest] = useState<PaymentRequestDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState("")
  const [payAmount, setPayAmount] = useState("")
  const [isPaying, setIsPaying] = useState(false)
  
  const isSignedIn = !!readSessionToken()

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

  // Set default pay amount to remaining amount
  useEffect(() => {
    if (request && !payAmount) {
      setPayAmount(request.amount_remaining)
    }
  }, [request, payAmount])

  const handlePayWithBalance = async () => {
    if (!request || !id) return
    
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid amount",
        variant: "destructive",
      })
      return
    }

    const remaining = parseFloat(request.amount_remaining)
    if (amount > remaining) {
      toast({
        title: "Amount too large",
        description: `Cannot pay more than ${formatRequestAmount(request.amount_remaining, request.asset)} ${request.asset}`,
        variant: "destructive",
      })
      return
    }

    if (!request.allow_partial && amount < remaining) {
      toast({
        title: "Partial payment not allowed",
        description: "This request must be paid in full",
        variant: "destructive",
      })
      return
    }

    if (request.min_amount && amount < parseFloat(request.min_amount)) {
      toast({
        title: "Amount too small",
        description: `Minimum amount is ${formatRequestAmount(request.min_amount, request.asset)} ${request.asset}`,
        variant: "destructive",
      })
      return
    }

    if (request.max_amount && amount > parseFloat(request.max_amount)) {
      toast({
        title: "Amount too large",
        description: `Maximum amount is ${formatRequestAmount(request.max_amount, request.asset)} ${request.asset}`,
        variant: "destructive",
      })
      return
    }

    setIsPaying(true)
    try {
      const idempotencyKey = `pay-${id}-${Date.now()}-${Math.random().toString(36).substring(7)}`
      await payPaymentRequest(id, {
        amount: payAmount,
        idempotency_key: idempotencyKey,
      })
      
      toast({
        title: "Payment successful",
        description: `Paid ${formatRequestAmount(payAmount, request.asset)} ${request.asset}`,
      })
      
      // Refresh the page state
      const updated = await getPaymentRequest(id)
      setRequest(updated)
      setPayAmount(updated.amount_remaining)
    } catch (e: unknown) {
      toast({
        title: "Payment failed",
        description: e instanceof Error ? e.message : "Could not complete payment",
        variant: "destructive",
      })
    } finally {
      setIsPaying(false)
    }
  }

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
              
              {/* Pay with EngiPay balance section */}
              {isSignedIn && isOpen && (
                <div className="space-y-3 border-t pt-4 text-left">
                  <h2 className="text-sm font-semibold">Pay with EngiPay balance</h2>
                  <div className="space-y-2">
                    <Label htmlFor="pay-amount">
                      Amount {request.allow_partial && "(partial payment allowed)"}
                    </Label>
                    <Input
                      id="pay-amount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      disabled={isPaying}
                    />
                  </div>
                  <Button
                    onClick={handlePayWithBalance}
                    disabled={isPaying || !payAmount}
                    className="w-full"
                  >
                    {isPaying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {isPaying ? "Processing..." : `Pay ${payAmount || "0"} ${request.asset}`}
                  </Button>
                </div>
              )}
              
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
