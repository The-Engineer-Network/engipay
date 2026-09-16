"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, ClipboardPaste, ExternalLink, QrCode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader } from "@/components/ui/loader"
import { useToast } from "@/hooks/use-toast"
import { useStellarWallet } from "@/contexts/StellarWalletContext"
import { useWallet } from "@/contexts/WalletContext"
import {
  STELLAR_AMOUNT,
  isStellarAddress,
  isStellarSecretKey,
  type StellarMemo,
} from "@/lib/payment-uri"
import { type StellarAssetCode, stellarNetwork, stellarTransactionUrl } from "@/lib/stellar"
import { cn } from "@/lib/utils"

const ASSETS: { code: StellarAssetCode; icon: string }[] = [
  { code: "XLM", icon: "\u{2728}" },
  { code: "USDC", icon: "\u{1F4B5}" },
]

interface StellarSendPaymentProps {
  initialRecipient?: string
  initialAmount?: string
  initialAsset?: string
  initialMemo?: StellarMemo
}

export function StellarSendPayment({
  initialRecipient = "",
  initialAmount = "",
  initialAsset = "XLM",
  initialMemo,
}: StellarSendPaymentProps) {
  const { toast } = useToast()
  const { connectWallet } = useWallet()
  const { isStellarConnected, balances, networkMismatch, sendStellarPayment } = useStellarWallet()

  const [recipient, setRecipient] = useState(initialRecipient)
  const [amount, setAmount] = useState(initialAmount)
  const [asset, setAsset] = useState<StellarAssetCode>(initialAsset === "USDC" ? "USDC" : "XLM")
  const [memoType, setMemoType] = useState<StellarMemo["type"]>(initialMemo?.type ?? "text")
  const [memo, setMemo] = useState(initialMemo?.value ?? "")
  const [isSending, setIsSending] = useState(false)
  const [sent, setSent] = useState<{ hash: string; createsAccount: boolean } | null>(null)

  const pastedSecret = isStellarSecretKey(recipient)
  const recipientValid = recipient === "" || isStellarAddress(recipient)
  const amountValid = amount === "" || (STELLAR_AMOUNT.test(amount) && Number(amount) > 0)
  const memoValid =
    memo === "" ||
    (memoType === "id"
      ? /^\d{1,20}$/.test(memo) && BigInt(memo) <= 18446744073709551615n
      : new TextEncoder().encode(memo).length <= 28)

  const available =
    asset === "XLM" ? balances?.xlmSpendable : balances?.usdc ?? (balances?.funded ? "0" : undefined)

  const pasteAddress = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setRecipient(text.trim())
    } catch {
      toast({ title: "Could not read the clipboard", description: "Paste the address manually instead.", variant: "destructive" })
    }
  }

  const handleSend = async () => {
    setIsSending(true)
    try {
      const result = await sendStellarPayment({
        destination: recipient,
        amount,
        asset,
        memo: memo ? { type: memoType, value: memo } : undefined,
      })
      setSent(result)
    } catch (error) {
      toast({
        title: "Payment not sent",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }

  if (!isStellarConnected) {
    return (
      <div className="glass-panel flex flex-col items-center gap-4 p-8 text-center">
        <p className="font-semibold">Connect a Stellar wallet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Sending XLM or USDC on Stellar is signed in Freighter, the Stellar Development
          Foundation&apos;s wallet. EngiPay never sees your key.
        </p>
        <Button className="glow-button rounded-full" onClick={connectWallet}>
          Connect Freighter
        </Button>
      </div>
    )
  }

  if (sent) {
    return (
      <div className="glass-panel p-8 text-center">
        <span className="pulse-ring mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
        </span>
        <p className="text-lg font-semibold">Payment sent</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {amount} {asset} arrived on {stellarNetwork.label}
          {sent.createsAccount ? ", and opened the recipient's Stellar account" : ""}. Stellar
          payments are final in seconds.
        </p>
        <a
          href={stellarTransactionUrl(sent.hash)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
        >
          View on Stellar Expert
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <Button
          variant="outline"
          className="mt-6 w-full rounded-full"
          onClick={() => {
            setSent(null)
            setRecipient("")
            setAmount("")
            setMemo("")
          }}
        >
          Send another
        </Button>
      </div>
    )
  }

  return (
    <div className="glass-panel space-y-6 p-6">
      {networkMismatch && (
        <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          {networkMismatch}
        </p>
      )}

      <div className="space-y-2">
        <Label>Asset</Label>
        <div className="flex flex-wrap gap-2">
          {ASSETS.map((option) => (
            <button
              key={option.code}
              type="button"
              onClick={() => setAsset(option.code)}
              aria-pressed={asset === option.code}
              className={cn(
                "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                asset === option.code
                  ? "border-primary/60 bg-primary/15 text-foreground"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              <span aria-hidden="true">{option.icon}</span>
              {option.code}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-4">
          <Label htmlFor="stellar-amount">Amount</Label>
          {available !== undefined && (
            <button
              type="button"
              onClick={() => setAmount(available)}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {asset === "XLM" ? "Available" : "You have"} {available} {asset}
            </button>
          )}
        </div>
        <div className="relative">
          <Input
            id="stellar-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.trim())}
            placeholder="0.00"
            aria-invalid={!amountValid}
            className="h-auto border-0 bg-transparent px-0 py-2 text-4xl font-semibold tabular-nums tracking-tight focus-visible:ring-0"
          />
          <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-lg font-medium text-muted-foreground">
            {asset}
          </span>
        </div>
        <div className="h-px bg-border" />
        {!amountValid && (
          <p className="text-sm text-destructive">Enter an amount above zero, with at most 7 decimal places.</p>
        )}
        {asset === "USDC" && balances?.funded && balances.usdc === null && (
          <p className="text-sm text-muted-foreground">
            Your Stellar account has not added USDC yet, so it holds none. Add USDC in Freighter to receive it.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="stellar-recipient">Send to</Label>
          <div className="flex items-center gap-3">
            <button type="button" onClick={pasteAddress} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <ClipboardPaste className="h-3 w-3" aria-hidden="true" />
              Paste
            </button>
            <Link href="/scan" className="flex items-center gap-1 text-xs text-primary hover:underline">
              <QrCode className="h-3 w-3" aria-hidden="true" />
              Scan
            </Link>
          </div>
        </div>
        <Input
          id="stellar-recipient"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value.trim())}
          placeholder="G... or M..."
          spellCheck={false}
          aria-invalid={!recipientValid}
          className="font-mono text-sm"
        />
        {pastedSecret ? (
          <p className="text-sm text-destructive">
            That is a Stellar secret key, not an address. Never share it. Anyone who has it can take
            the funds, so move them to a new account.
          </p>
        ) : (
          !recipientValid && <p className="text-sm text-destructive">That is not a valid Stellar address.</p>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="stellar-memo">Memo (optional)</Label>
          <div className="flex gap-1 rounded-full border border-border p-0.5 text-xs">
            {(["text", "id"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMemoType(type)}
                aria-pressed={memoType === type}
                className={cn(
                  "rounded-full px-2.5 py-0.5 transition-colors",
                  memoType === type ? "bg-primary/15 text-foreground" : "text-muted-foreground"
                )}
              >
                {type === "text" ? "Text" : "ID"}
              </button>
            ))}
          </div>
        </div>
        <Input
          id="stellar-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          placeholder={memoType === "id" ? "e.g. 1234567" : "e.g. invoice 42"}
          aria-invalid={!memoValid}
        />
        <p className={cn("text-xs", memoValid ? "text-muted-foreground" : "text-destructive")}>
          {memoValid
            ? "Exchanges often need a memo to credit you. Copy it exactly if they give you one."
            : memoType === "id"
              ? "A memo ID is a whole number."
              : "A text memo is at most 28 bytes."}
        </p>
      </div>

      <Button
        onClick={handleSend}
        disabled={
          isSending || !recipient || !amount || !recipientValid || !amountValid || !memoValid || Boolean(networkMismatch)
        }
        className="glow-button h-12 w-full rounded-full text-base font-semibold"
      >
        {isSending ? (
          <>
            <Loader className="mr-2 h-4 w-4" />
            Check Freighter…
          </>
        ) : (
          `Send ${asset}`
        )}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Sends on {stellarNetwork.label}. Stellar payments settle in about five seconds and cannot be
        reversed, so check the address and memo.
      </p>
    </div>
  )
}
