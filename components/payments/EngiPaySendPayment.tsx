"use client"

import { useState, useEffect, useId, useTransition } from "react"
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

const CUSTODIAL_ASSETS = ["USDC", "ETH", "XLM", "BTC"] as const
type CustodialAsset = (typeof CUSTODIAL_ASSETS)[number]

interface SavedContact {
  id: string
  label: string
  address: string
}

interface RecipientRisk {
  first_time: boolean
  look_alike: boolean
  similar_to?: string | null
}

async function getRecipientRisk(
  recipient: string,
  token: string
): Promise<RecipientRisk | null> {
  try {
    const res = await fetch(
      `/api/v1/contacts/risk?recipient=${encodeURIComponent(recipient)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return {
      first_time: Boolean(data.first_time),
      look_alike: Boolean(data.look_alike),
      similar_to: data.similar_to ?? null,
    }
  } catch {
    return null
  }
}

interface EngiPaySendPaymentProps {
  initialRecipient?: string
  initialAmount?: string
  initialAsset?: string
}

export function EngiPaySendPayment({
  initialRecipient = "",
  initialAmount = "",
  initialAsset = "USDC",
}: EngiPaySendPaymentProps) {
  const { toast } = useToast()
  const { balances, refetch } = useEngiPayBalances()

  const [tag, setTag] = useState(initialRecipient)
  const [contacts, setContacts] = useState<SavedContact[]>([])
  const [risk, setRisk] = useState<RecipientRisk | null>(null)
  const [isSavingContact, setIsSavingContact] = useState(false)
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

  // Find user's available balance for this asset
  const assetBalance = balances.find((b) => b.asset.toUpperCase() === asset.toUpperCase())
  const availableAmount = assetBalance?.available ?? "0"

  // Load saved contacts for the picker
  useEffect(() => {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null
    if (!token) return
    let cancelled = false
    fetch("/api/v1/contacts", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const list: SavedContact[] = Array.isArray(data) ? data : data.contacts ?? []
        setContacts(list)
      })
      .catch(() => {
        /* contacts are optional; ignore failures */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveContact = async () => {
    const cleanedTag = tag.trim()
    if (!cleanedTag || isSavingContact) return
    const token =
      typeof window !== "undefined" ? localStorage.getItem("engipay-token") : null
    if (!token) {
      setErrorMessage("Please sign in to save contacts.")
      return
    }
    setIsSavingContact(true)
    try {
      const res = await fetch("/api/v1/contacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ label: cleanedTag, address: cleanedTag }),
      })
      if (!res.ok) throw new Error("Failed to save contact")
      const saved = await res.json()
      setContacts((prev) => [...prev, saved])
      toast({ title: "Contact saved" })
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save contact")
    } finally {
      setIsSavingContact(false)
    }
  }

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

    // Check recipient risk (first-time recipient / look-alike address)
    const riskResult = await getRecipientRisk(cleanedTag, token)
    setRisk(riskResult)
    if (riskResult && (riskResult.first_time || riskResult.look_alike)) {
      setErrorMessage(
        riskResult.look_alike
          ? "This address looks very similar to one of your saved contacts. Double-check it before sending."
          : "This is your first payment to this recipient. Please confirm the details are correct."
      )
      setIsSubmitting(false)
      return
    }

    // Generate client-side UUID idempotency reference
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

      {risk && (risk.first_time || risk.look_alike) && (
        <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-xs text-warning-foreground">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p>
              {risk.look_alike
                ? "This address looks very similar to one of your saved contacts (possible address poisoning)."
                : "This is your first payment to this recipient."}
            </p>
            {risk.similar_to && (
              <p className="font-mono text-[11px] opacity-80">Similar to: {risk.similar_to}</p>
            )}
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={handleSaveContact}
              disabled={isSavingContact}
            >
              {isSavingContact ? "Saving..." : "Save recipient as a contact"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="engipay-recipient">Recipient (@tag or user ID)</Label>
        <Input
          id="engipay-recipient"
          placeholder="@alice"
          value={tag}
          onChange={(e) => {
            setTag(e.target.value)
            setRisk(null)
          }}
          disabled={isSubmitting}
        />
        {contacts.length > 0 && (
          <Select
            value=""
            onValueChange={(val) => {
              setTag(val)
              setRisk(null)
            }}
            disabled={isSubmitting}
          >
            <SelectTrigger aria-label="Pick a saved contact">
              <SelectValue placeholder="Pick a saved contact" />
            </SelectTrigger>
            <SelectContent>
              {contacts.map((contact) => (
                <SelectItem key={contact.id} value={contact.address}>
                  {contact.label} ({contact.address})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
          />
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
    </form>
  )
}
