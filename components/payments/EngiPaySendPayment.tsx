"use client"

import { useState, useEffect, useId } from "react"
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
import { useToast } from "@/hooks/use-toast"
import { useEngiPayBalances } from "@/hooks/use-engipay-balances"
import { Loader2, CheckCircle2, AlertCircle, ArrowUpRight, ShieldAlert } from "lucide-react"
import { SendStatusAnnouncement } from "@/components/payments/SendStatusAnnouncement"
import { getSendStatusAnnouncement, type SendPhase } from "@/lib/sendStatus"
import { getMe } from "@/lib/api-client"

const CUSTODIAL_ASSETS = ["USDC", "ETH", "XLM", "BTC"] as const
type CustodialAsset = (typeof CUSTODIAL_ASSETS)[number]

interface EngiPaySendPaymentProps {
  initialRecipient?: string
  initialAmount?: string
  initialAsset?: string
}

/**
 * Parse a daily_limit string such as "500 USDC" or "0.05 BTC".
 * Returns the numeric part, or null if parsing fails.
 */
function parseLimitAmount(limit: string): number | null {
  const match = limit.match(/^([\d.]+)/)
  if (!match) return null
  const n = parseFloat(match[1])
  return isNaN(n) ? null : n
}

export function EngiPaySendPayment({
  initialRecipient = "",
  initialAmount = "",
  initialAsset = "USDC",
}: EngiPaySendPaymentProps) {
  const { toast } = useToast()
  const { balances, refetch } = useEngiPayBalances()

  const [tag, setTag] = useState(initialRecipient)
  const [amount, setAmount] = useState(initialAmount)
  const [asset, setAsset] = useState<CustodialAsset>(
    CUSTODIAL_ASSETS.includes(initialAsset as CustodialAsset)
      ? (initialAsset as CustodialAsset)
      : "USDC"
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<{
    txId: string
    recipient: string
    amount: string
    asset: string
  } | null>(null)

  // Daily limit from /v1/me
  const [dailyLimit, setDailyLimit] = useState<string | null>(null)

  useEffect(() => {
    getMe()
      .then((me) => setDailyLimit(me.daily_limit))
      .catch(() => {
        // Not signed in or request failed — silently omit the limit display.
      })
  }, [])

  let sendPhase: SendPhase = "idle"
  let sendDetail: string | undefined
  if (receipt) {
    sendPhase = "success"
  } else if (errorMessage) {
    sendPhase = "error"
    sendDetail = errorMessage
  } else if (isSubmitting) {
    sendPhase = "waiting"
    sendDetail = "Please wait."
  }
  const sendAnnouncement = getSendStatusAnnouncement({ phase: sendPhase, detail: sendDetail })

  // Find user's available balance for this asset
  const assetBalance = balances.find((b) => b.asset.toUpperCase() === asset.toUpperCase())
  const availableAmount = assetBalance?.available ?? "0"

  // Warn when the entered amount exceeds the daily limit for this asset.
  const limitNumber = dailyLimit ? parseLimitAmount(dailyLimit) : null
  const enteredNumber = amount ? parseFloat(amount) : 0
  const exceedsLimit =
    limitNumber !== null &&
    enteredNumber > 0 &&
    // Only compare when the limit string contains the current asset symbol.
    dailyLimit?.toUpperCase().includes(asset.toUpperCase()) &&
    enteredNumber > limitNumber

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSubmitting) return

    setErrorMessage(null)

    const cleanedTag = tag.trim()
    if (!cleanedTag) {
      setErrorMessage("Please enter an @tag or recipient address.")
      return
    }

    if (!amount || Number(amount) <= 0) {
      setErrorMessage("Please enter a valid amount greater than zero.")
      return
    }

    if (Number(amount) > Number(availableAmount)) {
      setErrorMessage(
        `Insufficient balance. You have ${availableAmount} ${asset} available in your EngiPay account.`
      )
      return
    }

    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null
    if (!token) {
      setErrorMessage("Please sign in to send from your EngiPay balance.")
      return
    }

    setIsSubmitting(true)

    const idempotencyRef =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `ref-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

    try {
      const res = await fetch("/api/v1/transfers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient: cleanedTag,
          asset: asset.toUpperCase(),
          amount: amount.trim(),
          reference: idempotencyRef,
        }),
      })

      if (!res.ok) {
        let errorText = "Transfer failed"
        try {
          const json = await res.json()
          if (json.error) {
            errorText = json.error
          } else if (json.message) {
            errorText = json.message
          }
        } catch {
          errorText = `Server error (HTTP ${res.status})`
        }

        if (res.status === 400 && errorText.toLowerCase().includes("recipient")) {
          throw new Error(`Unknown recipient "${cleanedTag}". Please check the tag or address.`)
        }
        if (errorText.toLowerCase().includes("insufficient")) {
          throw new Error(`Insufficient balance to complete this transfer.`)
        }
        throw new Error(errorText)
      }

      const data = await res.json()
      setReceipt({
        txId: data.transaction_id ?? idempotencyRef,
        recipient: cleanedTag,
        amount: amount.trim(),
        asset: asset.toUpperCase(),
      })
      toast({ title: "Transfer completed instantly!" })
      refetch()
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to execute transfer")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (receipt) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-success/30 bg-success/10 p-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success text-success-foreground">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <div>
          <h3 className="text-lg font-semibold text-foreground">Payment Sent!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Sent <span className="font-medium text-foreground">{receipt.amount} {receipt.asset}</span> to{" "}
            <span className="font-medium text-foreground">{receipt.recipient}</span>
          </p>
          <p className="mt-2 text-xs font-mono text-muted-foreground">
            Transaction ID: {receipt.txId.slice(0, 16)}...
          </p>
        </div>
        <Button
          variant="outline"
          className="mt-2 rounded-full"
          onClick={() => {
            setReceipt(null)
            setAmount("")
            setTag("")
          }}
        >
          Send another payment
        </Button>
        <SendStatusAnnouncement message={sendAnnouncement} />
      </div>
    )
  }

  return (
    <form onSubmit={handleSend} className="space-y-4">
      {errorMessage && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="engipay-recipient">Recipient (@tag or user ID)</Label>
        <Input
          id="engipay-recipient"
          placeholder="@alice"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          disabled={isSubmitting}
        />
        <p className="text-[11px] text-muted-foreground">
          Internal EngiPay transfers settle immediately with zero network fees.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="engipay-asset">Asset</Label>
          <Select
            value={asset}
            onValueChange={(val) => setAsset(val as CustodialAsset)}
            disabled={isSubmitting}
          >
            <SelectTrigger id="engipay-asset">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTODIAL_ASSETS.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>
                  {symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="engipay-amount">Amount</Label>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              Avail: {availableAmount}
            </span>
          </div>
          <Input
            id="engipay-amount"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value.trim())}
            disabled={isSubmitting}
            aria-describedby="daily-limit-hint"
          />

          {/* Daily limit display */}
          <p
            id="daily-limit-hint"
            className={`flex items-center gap-1 text-[11px] tabular-nums ${
              exceedsLimit ? "text-destructive" : "text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {exceedsLimit ? (
              <>
                <ShieldAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                Amount exceeds your daily limit of {dailyLimit}.
              </>
            ) : dailyLimit ? (
              <>Daily limit: {dailyLimit}</>
            ) : null}
          </p>
        </div>
      </div>

      <Button
        type="submit"
        disabled={isSubmitting || !tag.trim() || !amount.trim()}
        className="w-full rounded-full"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : (
          <>
            <ArrowUpRight className="mr-1.5 h-4 w-4" />
            Send {amount ? `${amount} ${asset}` : "Payment"}
          </>
        )}
      </Button>
      <SendStatusAnnouncement message={sendAnnouncement} />
    </form>
  )
}
